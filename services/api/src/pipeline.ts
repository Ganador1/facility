/**
 * The SDLC pipeline as a classification of mirrored GitHub issues — the
 * server-side source of truth for pipeline state, consumed by agents (the
 * Product Owner reads it as a tool) and by the web. GitHub owns issues and
 * PRs; Facility owns runs, gates, and provenance.
 *
 * Placement is current-run-wins: the newest linked run explains an issue's
 * position. Live runs sit in their agent stage, failed runs sit there marked
 * failed (a failed attempt never rests in a human gate); otherwise delivery
 * evidence (builder success / PRs) → review, a published plan → ready.
 */

export type PipelineStage = "backlog" | "planning" | "ready" | "building" | "review" | "shipped";

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

export type PipelineRun = {
  id: string;
  mode: string;
  status: string;
  pr?: unknown;
};

export type PipelineIssueInput = {
  number: number;
  title: string;
  state: string;
  htmlUrl: string | null;
  ghUpdatedAt: Date | null;
  closedAt: Date | null;
  linkedRuns: PipelineRun[];
};

export type PlacedPipelineIssue = {
  number: number;
  title: string;
  state: string;
  htmlUrl: string | null;
  runState: "live" | "failed" | null;
  currentRun: { id: string; mode: string; status: string } | null;
  prs: { number: number; url: string }[];
};

const LIVE = new Set(["queued", "provisioning", "running"]);
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function isMode(run: { mode: string }, name: string) {
  return run.mode === name || run.mode === `codex-${name}`;
}

function stageForMode(run: PipelineRun): PipelineStage {
  if (isMode(run, "builder")) return "building";
  if (isMode(run, "review") || run.mode === "address-review") return "review";
  return "planning";
}

function prOf(run: PipelineRun): { number: number; url: string } | null {
  const pr = run.pr && typeof run.pr === "object" ? (run.pr as Record<string, unknown>) : null;
  if (pr && typeof pr.number === "number" && typeof pr.url === "string") {
    return { number: pr.number, url: pr.url };
  }
  return null;
}

function prsOf(runs: PipelineRun[]): { number: number; url: string }[] {
  const seen = new Map<number, { number: number; url: string }>();
  for (const run of runs) {
    const pr = prOf(run);
    if (pr) seen.set(pr.number, pr);
  }
  return [...seen.values()].sort((a, b) => a.number - b.number);
}

function placeOpen(
  issue: PipelineIssueInput,
  hasOpenProposal: boolean,
): { stage: PipelineStage; placed: PlacedPipelineIssue } {
  // Run ids are ULID-suffixed — lexicographic order is time order.
  const runs = [...issue.linkedRuns].sort((a, b) => a.id.localeCompare(b.id));
  const current = runs.at(-1) ?? null;
  const prs = prsOf(runs);
  const placed: PlacedPipelineIssue = {
    number: issue.number,
    title: issue.title,
    state: issue.state,
    htmlUrl: issue.htmlUrl,
    runState: null,
    currentRun: current ? { id: current.id, mode: current.mode, status: current.status } : null,
    prs,
  };
  if (current && LIVE.has(current.status)) {
    return { stage: stageForMode(current), placed: { ...placed, runState: "live" } };
  }
  if (current && current.status === "failed") {
    return { stage: stageForMode(current), placed: { ...placed, runState: "failed" } };
  }
  const builderDelivered = runs.some((r) => isMode(r, "builder") && r.status === "succeeded");
  if (builderDelivered || prs.length > 0) return { stage: "review", placed };
  const planPublished = runs.some((r) => isMode(r, "architect") && r.status === "succeeded");
  if (hasOpenProposal || planPublished) return { stage: "ready", placed };
  return { stage: "backlog", placed };
}

export function classifyPipeline(
  issues: PipelineIssueInput[],
  proposalIssueNumbers: ReadonlySet<number>,
  now = Date.now(),
): Map<PipelineStage, PlacedPipelineIssue[]> {
  const stages = new Map<PipelineStage, PlacedPipelineIssue[]>(
    PIPELINE_STAGES.map((s) => [s.key, []]),
  );
  for (const issue of issues) {
    if (issue.state === "open") {
      const { stage, placed } = placeOpen(issue, proposalIssueNumbers.has(issue.number));
      stages.get(stage)?.push(placed);
      continue;
    }
    // Shipped = closed this week, by close time. (The mirror doesn't
    // distinguish merged from closed; good enough until outcomes land.)
    const closedStamp = issue.closedAt ?? issue.ghUpdatedAt;
    if (closedStamp && now - closedStamp.getTime() < WEEK_MS) {
      const runs = [...issue.linkedRuns].sort((a, b) => a.id.localeCompare(b.id));
      const current = runs.at(-1) ?? null;
      stages.get("shipped")?.push({
        number: issue.number,
        title: issue.title,
        state: issue.state,
        htmlUrl: issue.htmlUrl,
        runState: null,
        currentRun: current ? { id: current.id, mode: current.mode, status: current.status } : null,
        prs: prsOf(runs),
      });
    }
  }
  return stages;
}
