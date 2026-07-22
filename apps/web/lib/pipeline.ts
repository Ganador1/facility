import type { Proposal } from "./api";

/**
 * The SDLC pipeline, as a classification of GitHub issues. This is the
 * product's mental model: work flows left to right, humans hold the gates.
 * GitHub is the source of truth for issues and PRs; Facility is the source
 * of truth for pipeline state (runs, gates, provenance).
 */
export type PipelineStage = "backlog" | "planning" | "ready" | "building" | "review" | "shipped";

/** Who acts in a stage: humans decide, agents work, done is done. */
export type StageKind = "human" | "agent" | "done";

export const PIPELINE_STAGES: {
  key: PipelineStage;
  label: string;
  sub: string;
  kind: StageKind;
}[] = [
  { key: "backlog", label: "Backlog", sub: "yours — pick up & launch", kind: "human" },
  { key: "planning", label: "Planning", sub: "architect drafts the plan", kind: "agent" },
  { key: "ready", label: "Ready", sub: "yours — review the plan", kind: "human" },
  { key: "building", label: "Building", sub: "builder implements the plan", kind: "agent" },
  { key: "review", label: "In review", sub: "yours — review the PR & iterate", kind: "human" },
  { key: "shipped", label: "Shipped", sub: "merged · last 7 days", kind: "done" },
];

export type LinkedRun = {
  id: string;
  mode: string;
  status: string;
  engine?: string;
  pr?: { number?: number; url?: string } | null;
};

/** The GitHub-issue mirror shape used by the pipeline (subset of the API item). */
export type PipelineIssue = {
  number: number;
  title: string;
  state: string;
  htmlUrl?: string;
  ghUpdatedAt?: string | null;
  closedAt?: string | null;
  linkedRuns?: LinkedRun[];
};

/** An issue placed in the pipeline, with its current run and PR provenance. */
export type PlacedIssue<T extends PipelineIssue = PipelineIssue> = {
  issue: T;
  /** live = an agent is on it now · failed = the last attempt broke */
  runState: "live" | "failed" | null;
  /** The single run that explains the issue's position — never a history. */
  currentRun: LinkedRun | null;
  /** Every PR any linked run produced (an issue may accumulate several). */
  prs: { number: number; url: string }[];
};

const LIVE = new Set(["queued", "provisioning", "running"]);
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function isMode(run: { mode: string }, name: string) {
  return run.mode === name || run.mode === `codex-${name}`;
}

function stageForMode(run: LinkedRun): PipelineStage {
  if (isMode(run, "builder")) return "building";
  if (isMode(run, "review") || run.mode === "address-review") return "review";
  return "planning";
}

/** Run ids are ULID-suffixed (`run_01…`) — lexicographic order is time order. */
function sortedRuns(issue: PipelineIssue): LinkedRun[] {
  return [...(issue.linkedRuns ?? [])].sort((a, b) => a.id.localeCompare(b.id));
}

export function prsOf(issue: PipelineIssue): { number: number; url: string }[] {
  const seen = new Map<number, { number: number; url: string }>();
  for (const run of issue.linkedRuns ?? []) {
    if (run.pr && typeof run.pr.number === "number" && typeof run.pr.url === "string") {
      seen.set(run.pr.number, { number: run.pr.number, url: run.pr.url });
    }
  }
  return [...seen.values()].sort((a, b) => a.number - b.number);
}

/** The one run that explains the issue's position: the newest linked run. */
export function currentRunOf(issue: PipelineIssue): LinkedRun | null {
  const runs = sortedRuns(issue);
  return runs.at(-1) ?? null;
}

/**
 * Current-run-wins placement of one open issue:
 * - the newest run is live → its stage (planning/building/review), yellow.
 * - the newest run failed → its stage, red. Failed attempts never sit in a gate.
 * - otherwise: delivered builder (PR) → review · plan published → ready → backlog.
 */
function placeOpen<T extends PipelineIssue>(
  issue: T,
  hasOpenProposal: boolean,
): { stage: PipelineStage; placed: PlacedIssue<T> } {
  const runs = sortedRuns(issue);
  const current = runs.at(-1) ?? null;
  const prs = prsOf(issue);
  const base: PlacedIssue<T> = { issue, runState: null, currentRun: current, prs };

  if (current && LIVE.has(current.status)) {
    return { stage: stageForMode(current), placed: { ...base, runState: "live" } };
  }
  if (current && current.status === "failed") {
    return { stage: stageForMode(current), placed: { ...base, runState: "failed" } };
  }
  const builderDelivered = runs.some((r) => isMode(r, "builder") && r.status === "succeeded");
  if (builderDelivered || prs.length > 0) return { stage: "review", placed: base };
  const planPublished = runs.some((r) => isMode(r, "architect") && r.status === "succeeded");
  if (hasOpenProposal || planPublished) return { stage: "ready", placed: base };
  return { stage: "backlog", placed: base };
}

export function classifyPipeline<T extends PipelineIssue>(
  issues: T[],
  proposals: Proposal[],
  now = Date.now(),
): Map<PipelineStage, PlacedIssue<T>[]> {
  const proposalIssueNumbers = new Set(
    proposals
      .map((p) => (p.payload as { issueNumber?: number } | null)?.issueNumber)
      .filter((n): n is number => typeof n === "number"),
  );
  const stages = new Map<PipelineStage, PlacedIssue<T>[]>(PIPELINE_STAGES.map((s) => [s.key, []]));
  for (const issue of issues) {
    if (issue.state === "open") {
      const { stage, placed } = placeOpen(issue, proposalIssueNumbers.has(issue.number));
      stages.get(stage)?.push(placed);
      continue;
    }
    // Shipped = closed this week, by close time — ghUpdatedAt would resurrect
    // an old closed issue whenever it gets a comment or label. (The mirror
    // doesn't distinguish merged from closed; good enough until outcomes land.)
    const closedStamp = issue.closedAt ?? issue.ghUpdatedAt;
    if (closedStamp && now - Date.parse(closedStamp) < WEEK_MS) {
      stages.get("shipped")?.push({
        issue,
        runState: null,
        currentRun: currentRunOf(issue),
        prs: prsOf(issue),
      });
    }
  }
  return stages;
}

export function pipelineCounts(stages: Map<PipelineStage, unknown[]>) {
  return PIPELINE_STAGES.map((s) => ({ ...s, count: stages.get(s.key)?.length ?? 0 }));
}
