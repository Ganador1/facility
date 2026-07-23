import type { GithubIssueDetail, Outcome, Proposal } from "./api";
import { PIPELINE_STAGES, type PipelineIssue, type PipelineStage, prsOf } from "./pipeline";

/**
 * The issue-detail payload IS a pipeline issue at runtime (same mirror row +
 * linkedRuns); only the generated `pr: unknown` typing is looser. One cast,
 * here, so every consumer stays typed.
 */
export function asPipelineIssue(detail: GithubIssueDetail): PipelineIssue {
  return detail as unknown as PipelineIssue;
}

/**
 * A story is the whole life of a unit of work — issue, agent runs, human
 * gates, PRs, the GitHub conversation — folded into one chronological
 * timeline. M1 derives it at read time from the existing stores; the M2
 * `story_events` log will make this a projection without changing the shape.
 */

export type StoryRun = GithubIssueDetail["runs"][number];

export type StoryComment = {
  id: number;
  author: string;
  bodyMd: string;
  createdAt: string;
  url: string;
};

export type StoryPr = {
  number: number;
  title: string;
  bodyMd: string;
  author: string;
  url: string;
  state: string;
};

export type StoryItem =
  | { kind: "issue_opened"; ts: string; author: string | null }
  | { kind: "run"; ts: string | null; run: StoryRun }
  | { kind: "proposal"; ts: string; proposal: Proposal }
  | { kind: "proposal_decided"; ts: string; proposal: Proposal }
  | { kind: "comment"; ts: string; comment: StoryComment }
  | { kind: "pr_opened"; ts: string; outcome: Outcome; pr: StoryPr | null }
  | { kind: "pr_closed"; ts: string; outcome: Outcome }
  | { kind: "issue_closed"; ts: string }
  | { kind: "stage"; ts: string; stage: PipelineStage };

function stamp(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  return null;
}

/** Proposals that belong to this story: their payload names the issue. */
export function proposalsForIssue(proposals: Proposal[], issueNumber: number): Proposal[] {
  return proposals.filter(
    (proposal) =>
      (proposal.payload as { issueNumber?: number } | null)?.issueNumber === issueNumber,
  );
}

export function stageLabel(stage: PipelineStage): string {
  return PIPELINE_STAGES.find((candidate) => candidate.key === stage)?.label ?? stage;
}

function isMode(mode: string, name: string) {
  return mode === name || mode === `codex-${name}`;
}

/**
 * The pipeline stage a timeline event moves the story INTO — the replayed
 * approximation of `classifyPipeline` (stages are derived, not stored, so
 * history is reconstructed from the events themselves).
 */
function stageEntered(item: StoryItem): PipelineStage | null {
  switch (item.kind) {
    case "issue_opened":
      return "backlog";
    case "run": {
      if (isMode(item.run.mode, "builder")) return "building";
      if (isMode(item.run.mode, "architect")) return "planning";
      return null;
    }
    case "proposal":
      return item.proposal.actionType === "plan_acceptance" ? "ready" : null;
    case "pr_opened":
      return "review";
    case "pr_closed":
      return item.outcome.fate === "merged" ? "shipped" : null;
    case "issue_closed":
      return "shipped";
    default:
      return null;
  }
}

export function deriveStoryTimeline(input: {
  detail: GithubIssueDetail;
  proposals: Proposal[];
  outcomes: Outcome[];
  comments?: StoryComment[];
  prs?: StoryPr[];
}): StoryItem[] {
  const { detail } = input;
  const items: StoryItem[] = [];

  const opened = stamp(detail.ghCreatedAt);
  if (opened) items.push({ kind: "issue_opened", ts: opened, author: detail.author });

  for (const run of detail.runs) {
    items.push({ kind: "run", ts: stamp(run.startedAt), run });
  }

  for (const proposal of proposalsForIssue(input.proposals, detail.number)) {
    const created = stamp(proposal.createdAt);
    if (created) items.push({ kind: "proposal", ts: created, proposal });
    const decided = stamp(proposal.decidedAt);
    if (decided) items.push({ kind: "proposal_decided", ts: decided, proposal });
  }

  for (const comment of input.comments ?? []) {
    items.push({ kind: "comment", ts: comment.createdAt, comment });
  }

  // PRs join primarily through the runs that produced them (runs.gh.pr); the
  // outcome.issue_number backfill is nightly, too late for live timelines.
  const prByNumber = new Map((input.prs ?? []).map((pr) => [pr.number, pr]));
  const prNumbers = new Set(prsOf(asPipelineIssue(detail)).map((pr) => pr.number));
  for (const outcome of input.outcomes) {
    const secondary = (outcome as { issueNumber?: number | null }).issueNumber;
    if (!prNumbers.has(outcome.prNumber) && secondary !== detail.number) continue;
    const openedAt = stamp(outcome.openedAt);
    if (openedAt) {
      items.push({
        kind: "pr_opened",
        ts: openedAt,
        outcome,
        pr: prByNumber.get(outcome.prNumber) ?? null,
      });
    }
    const terminalAt = stamp(outcome.terminalAt);
    if (terminalAt) items.push({ kind: "pr_closed", ts: terminalAt, outcome });
  }

  const closed = stamp(detail.closedAt);
  if (detail.state === "closed" && closed) items.push({ kind: "issue_closed", ts: closed });

  // Ascending by time; not-yet-started (queued) runs trail at the end —
  // they are the story's next beat, not its past.
  items.sort((a, b) => {
    if (a.ts === null) return 1;
    if (b.ts === null) return -1;
    return Date.parse(a.ts) - Date.parse(b.ts);
  });

  // Weave in the pipeline transitions the events imply. `backlog` at the
  // start is the birth state, not a transition — skip it.
  const withStages: StoryItem[] = [];
  let stage: PipelineStage | null = null;
  for (const item of items) {
    const entered = item.ts === null ? null : stageEntered(item);
    if (entered && entered !== stage) {
      if (stage !== null) withStages.push({ kind: "stage", ts: item.ts as string, stage: entered });
      stage = entered;
    }
    withStages.push(item);
  }
  return withStages;
}
