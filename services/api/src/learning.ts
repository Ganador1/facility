import { newId } from "@facility/core";
import { agentDefs, createDb, platformIssues, proposals, runEvents, runs } from "@facility/db";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import type { AppConfig } from "./types.js";

type Db = ReturnType<typeof createDb>["db"];

export type LearningPacket = {
  date: string;
  orgId: string;
  projectId: string;
  runs: unknown[];
  runEvents: unknown[];
  proposals: unknown[];
  issues: unknown[];
  digestMd: string;
};

export async function assembleLearningPacket(
  db: Db,
  orgId: string,
  projectId: string,
  date = new Date(),
): Promise<LearningPacket> {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const end = new Date(start.getTime() + 86_400_000 - 1);
  const day = start.toISOString().slice(0, 10);
  const dayRuns = await db
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
    .orderBy(desc(runs.createdAt));
  const events = dayRuns.length
    ? await db
        .select()
        .from(runEvents)
        .where(and(eq(runEvents.orgId, orgId), gte(runEvents.ts, start), lte(runEvents.ts, end)))
        .limit(500)
    : [];
  const dayProposals = await db
    .select()
    .from(proposals)
    .where(
      and(
        eq(proposals.orgId, orgId),
        eq(proposals.projectId, projectId),
        gte(proposals.createdAt, start),
        lte(proposals.createdAt, end),
      ),
    )
    .orderBy(desc(proposals.createdAt));
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
    .orderBy(desc(platformIssues.lastSeen));
  const digestMd = `# Learning packet ${day}

- Runs: ${dayRuns.length}
- Run events: ${events.length}
- HITL proposals: ${dayProposals.length}
- Platform issues: ${issues.length}
`;
  return {
    date: day,
    orgId,
    projectId,
    runs: dayRuns,
    runEvents: events,
    proposals: dayProposals,
    issues,
    digestMd,
  };
}

export async function runLearningNightly(
  config: AppConfig,
  enqueue: (queue: string, data: Record<string, unknown>) => Promise<unknown> = async () =>
    undefined,
) {
  const { db, client } = createDb(config.databaseUrl);
  const createdRuns: string[] = [];
  try {
    const agents = await db
      .select()
      .from(agentDefs)
      .where(and(eq(agentDefs.name, "learning"), eq(agentDefs.enabled, true)));
    for (const agent of agents) {
      const packet = await assembleLearningPacket(db, agent.orgId, agent.projectId);
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
