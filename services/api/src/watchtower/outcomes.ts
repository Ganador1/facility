import { newId } from "@facility/core";
import { createDb, type FacilityDb, integrations, outcomes, projects, repos } from "@facility/db";
import { and, eq } from "drizzle-orm";
import type { AppConfig } from "../types.js";
import {
  createGitHubClient,
  type GitHubClient,
  type PullCommit,
  type PullRequest,
} from "./github.js";
import { raisePlatformIssue, resolvePlatformIssue } from "./issues.js";

type ProjectSettings = {
  watchtower?: {
    branchPrefixes?: string[];
    outcomesLastRunAt?: string;
  };
  agentBranchPrefixes?: string[];
};

const DEFAULT_AGENT_BRANCH_PREFIXES = ["claude/", "codex/", "facility/"];
const DEFAULT_WINDOW_HOURS = 26;

function isBot(login: unknown) {
  return typeof login === "string" && login.endsWith("[bot]");
}

function branchPrefixes(settings: unknown) {
  const parsed = settings as ProjectSettings;
  const configured = parsed.watchtower?.branchPrefixes ?? parsed.agentBranchPrefixes;
  return Array.isArray(configured) && configured.every((item) => typeof item === "string")
    ? configured
    : DEFAULT_AGENT_BRANCH_PREFIXES;
}

function cursor(settings: unknown) {
  const value = (settings as ProjectSettings).watchtower?.outcomesLastRunAt;
  return typeof value === "string"
    ? new Date(value)
    : new Date(Date.now() - DEFAULT_WINDOW_HOURS * 3600_000);
}

function isAgentPr(pr: PullRequest, commits: PullCommit[], prefixes: string[]) {
  if (isBot(pr.user?.login)) return true;
  if (prefixes.some((prefix) => pr.head?.ref?.startsWith(prefix))) return true;
  return commits.length > 0 && isBot(commits[0]?.author?.login);
}

function fixupCommits(commits: PullCommit[]) {
  const firstBotIndex = commits.findIndex((commit) => isBot(commit.author?.login));
  if (firstBotIndex === -1) return 0;
  return commits
    .slice(firstBotIndex + 1)
    .filter((commit) => commit.author?.login && !isBot(commit.author.login)).length;
}

function laneFor(pr: PullRequest) {
  return pr.head?.ref?.split("/")[0] ?? "unknown";
}

function hoursToTerminal(pr: PullRequest) {
  if (!pr.closed_at) return null;
  return Math.round((Date.parse(pr.closed_at) - Date.parse(pr.created_at)) / 3600_000);
}

export async function runWatchtowerOutcomes(
  config: AppConfig,
  github: GitHubClient = createGitHubClient(),
) {
  const { db, client } = createDb(config.databaseUrl);
  try {
    await collectOutcomes(db, github);
  } finally {
    await client.end();
  }
}

export async function collectOutcomes(db: FacilityDb, github: GitHubClient) {
  const activeProjects = await db.select().from(projects).where(eq(projects.status, "active"));
  const collectedAt = new Date();
  for (const project of activeProjects) {
    const projectRepos = await db.select().from(repos).where(eq(repos.projectId, project.id));
    if (projectRepos.length === 0) continue;
    const since = cursor(project.settings);
    const prefixes = branchPrefixes(project.settings);
    const collected = [];
    for (const repo of projectRepos) {
      const repoName = `${repo.owner}/${repo.name}`;
      const closed = (await github.listClosedPulls({ owner: repo.owner, name: repo.name })).filter(
        (pr) => pr.closed_at && Date.parse(pr.closed_at) >= since.getTime(),
      );
      for (const pr of closed) {
        const commits = await github.listPullCommits(
          { owner: repo.owner, name: repo.name },
          pr.number,
        );
        if (!isAgentPr(pr, commits, prefixes)) continue;
        const reviews = await github.listPullReviews(
          { owner: repo.owner, name: repo.name },
          pr.number,
        );
        const reviewRounds = reviews.filter(
          (review) => review.state === "CHANGES_REQUESTED",
        ).length;
        const fixups = fixupCommits(commits);
        const fate = pr.merged_at ? "merged" : "closed";
        const hours = hoursToTerminal(pr);
        await db
          .insert(outcomes)
          .values({
            id: newId("evt"),
            orgId: project.orgId,
            projectId: project.id,
            repo: repoName,
            prNumber: pr.number,
            agentLane: laneFor(pr),
            openedAt: new Date(pr.created_at),
            terminalAt: pr.closed_at ? new Date(pr.closed_at) : undefined,
            fate,
            reviewRounds,
            fixupCommits: fixups,
            hoursToTerminal: hours == null ? undefined : String(hours),
          })
          .onConflictDoUpdate({
            target: [outcomes.orgId, outcomes.repo, outcomes.prNumber],
            set: {
              agentLane: laneFor(pr),
              terminalAt: pr.closed_at ? new Date(pr.closed_at) : undefined,
              fate,
              reviewRounds,
              fixupCommits: fixups,
              hoursToTerminal: hours == null ? undefined : String(hours),
              updatedAt: collectedAt,
            },
          });
        collected.push({
          pr: pr.number,
          repo: repoName,
          merged: Boolean(pr.merged_at),
          reviewRounds,
          humanFixups: fixups,
        });
      }
    }
    const merged = collected.filter((item) => item.merged).length;
    const oneShot = collected.filter(
      (item) => item.merged && item.reviewRounds === 0 && item.humanFixups === 0,
    ).length;
    const summary = {
      schema: "facility.watchtower.outcomes.v1",
      collectedAt: collectedAt.toISOString(),
      windowHours: Math.round((collectedAt.getTime() - since.getTime()) / 3600_000),
      agentPrs: collected.length,
      merged,
      rejected: collected.length - merged,
      acceptance: collected.length ? Math.round((100 * merged) / collected.length) : null,
      oneShot,
      outcomes: collected,
    };
    await postOutcomeSinks(db, project.orgId, project.id, summary);
    await persistCursor(db, project.id, project.settings, collectedAt);
  }
}

async function postOutcomeSinks(
  db: FacilityDb,
  orgId: string,
  projectId: string,
  summary: Record<string, unknown>,
) {
  const sinks = await db
    .select()
    .from(integrations)
    .where(
      and(
        eq(integrations.orgId, orgId),
        eq(integrations.kind, "webhook"),
        eq(integrations.enabled, true),
      ),
    );
  for (const sink of sinks.filter(
    (item) => item.projectId === projectId || item.projectId == null,
  )) {
    const config = sink.config as { outcomes_sink?: boolean; url?: string };
    if (!config.outcomes_sink || !config.url) continue;
    const fingerprint = `integration_error:${sink.id}:outcomes_sink`;
    try {
      const response = await fetch(config.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(summary),
      });
      if (!response.ok) throw new Error(`webhook_status:${response.status}`);
      await resolvePlatformIssue(db, orgId, fingerprint, "outcomes sink delivered successfully");
    } catch (error) {
      await raisePlatformIssue(db, {
        orgId,
        projectId,
        kind: "integration_error",
        severity: "error",
        fingerprint,
        title: "Outcomes sink failed",
        bodyMd: error instanceof Error ? error.message : "Unknown webhook delivery error",
      });
    }
  }
}

async function persistCursor(
  db: FacilityDb,
  projectId: string,
  settings: unknown,
  collectedAt: Date,
) {
  const current = (settings && typeof settings === "object" ? settings : {}) as Record<
    string,
    unknown
  >;
  const watchtower =
    current.watchtower && typeof current.watchtower === "object"
      ? (current.watchtower as Record<string, unknown>)
      : {};
  await db
    .update(projects)
    .set({
      settings: {
        ...current,
        watchtower: { ...watchtower, outcomesLastRunAt: collectedAt.toISOString() },
      },
      updatedAt: collectedAt,
    })
    .where(eq(projects.id, projectId));
}
