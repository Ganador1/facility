import { FacilityReceiptSchema, newId, verifyFacilityReceipt } from "@facility/core";
import {
  agentDefs,
  budgets,
  createDb,
  githubInstallations,
  outcomes,
  platformIssues,
  proposalEvents,
  proposals,
  repos,
  runEvents,
  runs,
  spendCounters,
} from "@facility/db";
import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import {
  createGithubClientFactory,
  FacilityGithubClient,
  type GithubClientFactory,
} from "./github/client.js";
import type { AppConfig } from "./types.js";

type Db = ReturnType<typeof createDb>["db"];
type Outcome = typeof outcomes.$inferSelect;

export type LearningPacket = {
  schema: "facility.learning.packet.v2";
  date: string;
  window: { from: string; to: string; days: 30 };
  orgId: string;
  projectId: string;
  runs: unknown[];
  receipts: unknown[];
  runEvents: unknown[];
  guardResults: unknown[];
  outcomes: Outcome[];
  githubReviewThreads: unknown[];
  budgetBreaches: unknown[];
  proposals: unknown[];
  proposalEvents: unknown[];
  historicalRejections: unknown[];
  improvementEffectiveness: unknown[];
  issues: unknown[];
  evidenceWarnings: string[];
  digestMd: string;
};

/**
 * Build the deterministic, database-backed portion of a learning packet.
 * External review evidence is attached separately so a GitHub outage cannot
 * prevent the nightly learning run from being created.
 */
export async function assembleLearningPacket(
  db: Db,
  orgId: string,
  projectId: string,
  date = new Date(),
): Promise<LearningPacket> {
  const end = new Date(date);
  const start = new Date(end.getTime() - 30 * 86_400_000);
  const day = end.toISOString().slice(0, 10);
  const window = { from: start.toISOString(), to: end.toISOString(), days: 30 as const };
  const windowRuns = await db
    .select()
    .from(runs)
    .where(
      and(
        eq(runs.orgId, orgId),
        eq(runs.projectId, projectId),
        gte(runs.createdAt, start),
        lte(runs.createdAt, end),
      ),
    )
    .orderBy(desc(runs.createdAt))
    .limit(500);
  const events = windowRuns.length
    ? await db
        .select()
        .from(runEvents)
        .where(
          and(
            eq(runEvents.orgId, orgId),
            inArray(
              runEvents.runId,
              windowRuns.map((run) => run.id),
            ),
            gte(runEvents.ts, start),
            lte(runEvents.ts, end),
          ),
        )
        .limit(2_000)
    : [];
  const windowProposals = await db
    .select()
    .from(proposals)
    .where(
      and(
        eq(proposals.orgId, orgId),
        eq(proposals.projectId, projectId),
        gte(proposals.updatedAt, start),
        lte(proposals.updatedAt, end),
      ),
    )
    .orderBy(desc(proposals.updatedAt))
    .limit(500);
  const decisionEvents = windowProposals.length
    ? await db
        .select()
        .from(proposalEvents)
        .where(
          and(
            eq(proposalEvents.orgId, orgId),
            inArray(
              proposalEvents.proposalId,
              windowProposals.map((proposal) => proposal.id),
            ),
            gte(proposalEvents.ts, start),
            lte(proposalEvents.ts, end),
          ),
        )
        .limit(1_000)
    : [];
  const projectOutcomes = await db
    .select()
    .from(outcomes)
    .where(
      and(
        eq(outcomes.orgId, orgId),
        eq(outcomes.projectId, projectId),
        gte(outcomes.openedAt, start),
        lte(outcomes.openedAt, end),
      ),
    )
    .orderBy(desc(outcomes.openedAt))
    .limit(100);
  const issues = await db
    .select()
    .from(platformIssues)
    .where(
      and(
        eq(platformIssues.orgId, orgId),
        eq(platformIssues.projectId, projectId),
        gte(platformIssues.lastSeen, start),
        lte(platformIssues.lastSeen, end),
      ),
    )
    .orderBy(desc(platformIssues.lastSeen))
    .limit(500);
  const projectAgents = await db
    .select({ id: agentDefs.id })
    .from(agentDefs)
    .where(and(eq(agentDefs.orgId, orgId), eq(agentDefs.projectId, projectId)));
  const enabledBudgets = await db
    .select()
    .from(budgets)
    .where(and(eq(budgets.orgId, orgId), eq(budgets.enabled, true)));
  const applicableBudgets = enabledBudgets.filter(
    (budget) =>
      budget.scope === "org" ||
      (budget.scope === "project" && budget.projectId === projectId) ||
      (budget.scope === "agent_def" &&
        budget.projectId === projectId &&
        projectAgents.some((agent) => agent.id === budget.agentDefId)),
  );
  const counters = applicableBudgets.length
    ? await db
        .select()
        .from(spendCounters)
        .where(
          and(
            eq(spendCounters.orgId, orgId),
            inArray(
              spendCounters.budgetId,
              applicableBudgets.map((budget) => budget.id),
            ),
            gte(spendCounters.windowStart, start.toISOString().slice(0, 10)),
          ),
        )
    : [];
  const budgetById = new Map(applicableBudgets.map((budget) => [budget.id, budget]));
  const budgetBreaches = counters.flatMap((counter) => {
    const budget = budgetById.get(counter.budgetId);
    if (!budget || Number(counter.spentCents) <= budget.limitCents) return [];
    return [
      {
        budgetId: budget.id,
        scope: budget.scope,
        period: budget.period,
        mode: budget.mode,
        windowStart: counter.windowStart,
        limitCents: budget.limitCents,
        spentCents: Number(counter.spentCents),
        exceededByCents: Number(counter.spentCents) - budget.limitCents,
      },
    ];
  });
  const receipts = windowRuns.map((run) => {
    const parsed = FacilityReceiptSchema.safeParse(run.receipt);
    const integrityOk = parsed.success && verifyFacilityReceipt(parsed.data);
    return {
      runId: run.id,
      terminal: ["succeeded", "failed", "canceled"].includes(run.status),
      present: run.receipt !== null,
      integrity: {
        ok: integrityOk,
        errors: parsed.success ? (integrityOk ? [] : ["digest_mismatch"]) : ["invalid_schema"],
      },
      receipt: parsed.success ? parsed.data : run.receipt,
    };
  });
  const guardResults = events
    .filter((event) => event.type === "check" || event.type.startsWith("guard."))
    .map((event) => ({ runId: event.runId, ts: event.ts, type: event.type, data: event.data }));
  const historicalRejections = windowProposals
    .filter((proposal) => proposal.state === "rejected")
    .map((proposal) => ({
      proposal,
      events: decisionEvents.filter((event) => event.proposalId === proposal.id),
    }));
  const recurrenceFingerprints = decisionEvents.flatMap((event) => {
    const recurrence = objectOrEmpty(objectOrEmpty(event.data).recurrence);
    return arrayOfStrings(recurrence.fingerprints);
  });
  const recurrenceIssues = recurrenceFingerprints.length
    ? await db
        .select()
        .from(platformIssues)
        .where(
          and(
            eq(platformIssues.orgId, orgId),
            eq(platformIssues.projectId, projectId),
            inArray(platformIssues.fingerprint, [...new Set(recurrenceFingerprints)]),
          ),
        )
    : [];
  const recurrenceIssueByFingerprint = new Map(
    recurrenceIssues.map((issue) => [issue.fingerprint, issue]),
  );
  const improvementEffectiveness = decisionEvents
    .filter((event) => event.type === "executed")
    .flatMap((event): unknown[] => {
      const data = objectOrEmpty(event.data);
      if (
        !["skill_proposal", "rule_proposal", "guard_candidate"].includes(String(data.actionType))
      ) {
        return [];
      }
      const recurrence = objectOrEmpty(data.recurrence);
      const proposal = windowProposals.find((candidate) => candidate.id === event.proposalId);
      const fingerprints = arrayOfStrings(recurrence.fingerprints);
      const evaluationWindowDays = boundedDays(recurrence.evaluationWindowDays, 7);
      if (recurrence.configured !== true || fingerprints.length === 0) {
        return [
          {
            proposalId: event.proposalId,
            actionType: String(data.actionType),
            activatedAt: event.ts.toISOString(),
            evaluationWindowDays,
            status: "unconfigured",
            reason: "recurrence_fingerprints were not supplied",
            proposal,
          },
        ];
      }
      const baselineByFingerprint = new Map(
        arrayOfObjects(recurrence.baseline).map((item) => [String(item.fingerprint), item]),
      );
      const activatedAt = event.ts;
      const elapsedDays = Math.max(1, (end.getTime() - activatedAt.getTime()) / 86_400_000);
      let beforeOccurrences = 0;
      let afterOccurrences = 0;
      let beforeRatePerDay = 0;
      let afterRatePerDay = 0;
      const targets = fingerprints.map((fingerprint) => {
        const baseline = baselineByFingerprint.get(fingerprint);
        const baselineCount = nonNegativeNumber(baseline?.count);
        const currentCount = recurrenceIssueByFingerprint.get(fingerprint)?.count ?? baselineCount;
        const firstSeen = dateOrNull(baseline?.firstSeen) ?? activatedAt;
        const observedBeforeDays = Math.max(
          1,
          (activatedAt.getTime() - firstSeen.getTime()) / 86_400_000,
        );
        const recurrences = Math.max(0, currentCount - baselineCount);
        const targetBeforeRatePerDay = baselineCount / observedBeforeDays;
        const targetAfterRatePerDay = recurrences / elapsedDays;
        beforeOccurrences += baselineCount;
        afterOccurrences += recurrences;
        beforeRatePerDay += targetBeforeRatePerDay;
        afterRatePerDay += targetAfterRatePerDay;
        return {
          fingerprint,
          baselineCount,
          currentCount,
          recurrences,
          beforeRatePerDay: targetBeforeRatePerDay,
          afterRatePerDay: targetAfterRatePerDay,
        };
      });
      const trend =
        afterRatePerDay < beforeRatePerDay
          ? "reduced"
          : afterRatePerDay > beforeRatePerDay
            ? "increased"
            : "unchanged";
      return [
        {
          proposalId: event.proposalId,
          actionType: String(data.actionType),
          activatedAt: activatedAt.toISOString(),
          evaluationWindowDays,
          status: elapsedDays >= evaluationWindowDays ? "evaluated" : "measuring",
          trend,
          beforeOccurrences,
          afterOccurrences,
          beforeRatePerDay,
          afterRatePerDay,
          targets,
          proposal,
        },
      ];
    });
  const evidenceWarnings = [
    ...(receipts.some((item) => item.terminal && !item.integrity.ok)
      ? ["One or more terminal runs have a missing or invalid receipt."]
      : []),
  ];
  const digestMd = renderDigest({
    day,
    window,
    runCount: windowRuns.length,
    receiptCount: receipts.filter((item) => item.integrity.ok).length,
    eventCount: events.length,
    guardCount: guardResults.length,
    outcomeCount: projectOutcomes.length,
    budgetBreachCount: budgetBreaches.length,
    proposalCount: windowProposals.length,
    rejectionCount: historicalRejections.length,
    effectivenessCount: improvementEffectiveness.length,
    issueCount: issues.length,
    reviewThreadCount: 0,
    evidenceWarnings,
  });
  return {
    schema: "facility.learning.packet.v2",
    date: day,
    window,
    orgId,
    projectId,
    runs: windowRuns,
    receipts,
    runEvents: events,
    guardResults,
    outcomes: projectOutcomes,
    githubReviewThreads: [],
    budgetBreaches,
    proposals: windowProposals,
    proposalEvents: decisionEvents,
    historicalRejections,
    improvementEffectiveness,
    issues,
    evidenceWarnings,
    digestMd,
  };
}

export async function attachGithubReviewEvidence(
  db: Db,
  packet: LearningPacket,
  factory?: GithubClientFactory,
): Promise<LearningPacket> {
  if (!factory) {
    return withReviewDigest(
      packet,
      [],
      "GitHub review evidence unavailable: App credentials are not configured.",
    );
  }
  const registrations = await db
    .select({
      owner: repos.owner,
      name: repos.name,
      defaultBranch: repos.defaultBranch,
      installationId: githubInstallations.installationId,
    })
    .from(repos)
    .innerJoin(githubInstallations, eq(repos.installationId, githubInstallations.id))
    .where(and(eq(repos.orgId, packet.orgId), eq(repos.projectId, packet.projectId)));
  const byName = new Map(registrations.map((repo) => [`${repo.owner}/${repo.name}`, repo]));
  const reviewEvidence: unknown[] = [];
  const warnings: string[] = [];
  for (const outcome of packet.outcomes.slice(0, 50)) {
    const registration = byName.get(outcome.repo);
    if (!registration) {
      warnings.push(
        `GitHub review evidence unavailable for unregistered repository ${outcome.repo}.`,
      );
      continue;
    }
    try {
      const octokit = await factory(registration.installationId);
      const client = new FacilityGithubClient(octokit, {
        owner: registration.owner,
        repo: registration.name,
        defaultBranch: registration.defaultBranch,
      });
      reviewEvidence.push({
        repo: outcome.repo,
        outcomeId: outcome.id,
        ...(await client.listReviewThreads(outcome.prNumber)),
      });
    } catch (error) {
      warnings.push(
        `GitHub review evidence unavailable for ${outcome.repo}#${outcome.prNumber}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  return withReviewDigest(packet, reviewEvidence, ...warnings);
}

export async function runLearningNightly(
  config: AppConfig,
  enqueue: (queue: string, data: Record<string, unknown>) => Promise<unknown> = async () =>
    undefined,
) {
  const { db, client } = createDb(config.databaseUrl);
  const createdRuns: string[] = [];
  let githubFactory: GithubClientFactory | undefined;
  if (config.githubAppId && config.githubAppPrivateKey) {
    githubFactory = createGithubClientFactory(config);
  }
  try {
    const agents = await db
      .select()
      .from(agentDefs)
      .where(and(eq(agentDefs.name, "learning"), eq(agentDefs.enabled, true)));
    for (const agent of agents) {
      const basePacket = await assembleLearningPacket(db, agent.orgId, agent.projectId);
      const packet = await attachGithubReviewEvidence(db, basePacket, githubFactory);
      const packetUrl = `facility://learning-packets/${agent.projectId}/${packet.date}`;
      const run = (
        await db
          .insert(runs)
          .values({
            id: newId("run"),
            orgId: agent.orgId,
            projectId: agent.projectId,
            agentDefId: agent.id,
            mode: "learning",
            engine: agent.engine,
            trigger: { type: "schedule", packetUrl, packet },
            createdBy: { type: "system", id: "learning.nightly" },
          })
          .returning()
      )[0];
      if (run) {
        createdRuns.push(run.id);
        await enqueue("runs.dispatch", { runId: run.id, orgId: run.orgId });
      }
    }
    return { createdRuns };
  } finally {
    await client.end();
  }
}

function withReviewDigest(packet: LearningPacket, evidence: unknown[], ...warnings: string[]) {
  const evidenceWarnings = [...new Set([...packet.evidenceWarnings, ...warnings])];
  return {
    ...packet,
    githubReviewThreads: evidence,
    evidenceWarnings,
    digestMd: packet.digestMd
      .replace("- GitHub review packets: 0", `- GitHub review packets: ${evidence.length}`)
      .replace(/- Evidence warnings: \d+/, `- Evidence warnings: ${evidenceWarnings.length}`),
  };
}

function objectOrEmpty(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function arrayOfStrings(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
}

function arrayOfObjects(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(objectOrEmpty) : [];
}

function boundedDays(value: unknown, fallback: number) {
  const days = Number(value);
  return Number.isInteger(days) && days >= 1 && days <= 30 ? days : fallback;
}

function nonNegativeNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function dateOrNull(value: unknown) {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function renderDigest(input: {
  day: string;
  window: LearningPacket["window"];
  runCount: number;
  receiptCount: number;
  eventCount: number;
  guardCount: number;
  outcomeCount: number;
  budgetBreachCount: number;
  proposalCount: number;
  rejectionCount: number;
  effectivenessCount: number;
  issueCount: number;
  reviewThreadCount: number;
  evidenceWarnings: string[];
}) {
  return `# Learning packet ${input.day}

Window: ${input.window.from} to ${input.window.to} (rolling 30 days)

- Runs: ${input.runCount}
- Verified receipts: ${input.receiptCount}
- Run events: ${input.eventCount}
- Guard/check results: ${input.guardCount}
- Delivery outcomes: ${input.outcomeCount}
- GitHub review packets: ${input.reviewThreadCount}
- Budget breaches: ${input.budgetBreachCount}
- HITL proposals: ${input.proposalCount}
- Historical rejections: ${input.rejectionCount}
- Accepted improvements measured: ${input.effectivenessCount}
- Platform issues: ${input.issueCount}
- Evidence warnings: ${input.evidenceWarnings.length}
`;
}
