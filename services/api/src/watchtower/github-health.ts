import { type FacilityDb, repos } from "@facility/db";
import type { GitHubClient, GitHubRepoRef, WorkflowRun } from "./github.js";
import { raisePlatformIssue, resolvePlatformIssue } from "./issues.js";

const WATCHLIST = [
  "facility-crew",
  "facility-review",
  "facility-address-review",
  "facility-doctor",
  "facility-security-sweep",
  "facility-canary",
];
const FAILURE_CONCLUSIONS = new Set(["failure", "startup_failure", "timed_out"]);

type BudgetFile = {
  maxDailyFailures?: Record<string, number>;
  maxWeeklyRuns?: Record<string, number>;
};

function iso(hoursAgo: number) {
  return new Date(Date.now() - hoursAgo * 3600_000).toISOString();
}

function budgetFor(map: Record<string, number> | undefined, name: string, fallback: number) {
  return map?.[name] ?? map?.["*"] ?? fallback;
}

function runsForWorkflow(runs: WorkflowRun[], name: string) {
  return runs.filter((run) => run.name === name);
}

function failures(runs: WorkflowRun[]) {
  return runs.filter((run) => FAILURE_CONCLUSIONS.has(run.conclusion ?? ""));
}

async function readBudgets(github: GitHubClient, repo: GitHubRepoRef, defaultBranch: string) {
  const defaults: BudgetFile = { maxDailyFailures: { "*": 3 }, maxWeeklyRuns: {} };
  const text = await github.readTextFile(
    repo,
    ".github/facility/watchtower/budgets.json",
    defaultBranch,
  );
  if (!text) return defaults;
  return { ...defaults, ...(JSON.parse(text) as BudgetFile) };
}

export async function collectGitHubHealth(db: FacilityDb, github: GitHubClient) {
  const allRepos = await db.select().from(repos);
  const activeFingerprints = new Set<string>();
  for (const repo of allRepos) {
    const ref = { owner: repo.owner, name: repo.name };
    const budgets = await readBudgets(github, ref, repo.defaultBranch);
    const day = (await github.listWorkflowRuns(ref, iso(24))).filter((run) =>
      WATCHLIST.includes(run.name ?? ""),
    );
    const week = (await github.listWorkflowRuns(ref, iso(24 * 7))).filter((run) =>
      WATCHLIST.includes(run.name ?? ""),
    );
    for (const name of WATCHLIST) {
      const daily = runsForWorkflow(day, name);
      const failed = failures(daily);
      const weeklyCount = runsForWorkflow(week, name).length;
      const maxFail = budgetFor(budgets.maxDailyFailures, name, 3);
      const maxWeekly = budgetFor(budgets.maxWeeklyRuns, name, Number.POSITIVE_INFINITY);
      const failFingerprint = `run_failure:${repo.id}:${name}:24h`;
      const budgetFingerprint = `budget_breach:${repo.id}:${name}:7d_runs`;
      if (failed.length >= maxFail) {
        activeFingerprints.add(failFingerprint);
        await raisePlatformIssue(db, {
          orgId: repo.orgId,
          projectId: repo.projectId,
          kind: "run_failure",
          severity: "error",
          fingerprint: failFingerprint,
          title: `${name} workflow failures`,
          bodyMd: `${failed.length} failures in 24h (budget ${maxFail}). Latest: ${
            failed[0]?.html_url ?? "unknown"
          }`,
        });
      } else {
        await resolvePlatformIssue(db, repo.orgId, failFingerprint, "workflow failures recovered");
      }
      if (weeklyCount > maxWeekly) {
        activeFingerprints.add(budgetFingerprint);
        await raisePlatformIssue(db, {
          orgId: repo.orgId,
          projectId: repo.projectId,
          kind: "budget_breach",
          severity: "error",
          fingerprint: budgetFingerprint,
          title: `${name} workflow run budget breached`,
          bodyMd: `${weeklyCount} runs this week (budget ${maxWeekly}).`,
        });
      } else {
        await resolvePlatformIssue(
          db,
          repo.orgId,
          budgetFingerprint,
          "workflow run budget recovered",
        );
      }
    }
  }
  return { activeFingerprints: [...activeFingerprints] };
}
