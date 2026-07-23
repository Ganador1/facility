import type { GithubIssueDetail, Outcome, Proposal } from "./api";
import { type PipelineIssue, prsOf } from "./pipeline";

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
 * gates, PRs — folded into one chronological timeline. M1 derives it at read
 * time from the existing stores; the M2 `story_events` log will make this a
 * projection without changing the shape.
 */

export type StoryRun = GithubIssueDetail["runs"][number];

export type StoryItem =
  | { kind: "issue_opened"; ts: string; author: string | null }
  | { kind: "run"; ts: string | null; run: StoryRun }
  | { kind: "proposal"; ts: string; proposal: Proposal }
  | { kind: "proposal_decided"; ts: string; proposal: Proposal }
  | { kind: "pr_opened"; ts: string; outcome: Outcome }
  | { kind: "pr_closed"; ts: string; outcome: Outcome }
  | { kind: "issue_closed"; ts: string };

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

export function deriveStoryTimeline(input: {
  detail: GithubIssueDetail;
  proposals: Proposal[];
  outcomes: Outcome[];
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

  // PRs join primarily through the runs that produced them (runs.gh.pr); the
  // outcome.issue_number backfill is nightly, too late for live timelines.
  const prNumbers = new Set(prsOf(asPipelineIssue(detail)).map((pr) => pr.number));
  for (const outcome of input.outcomes) {
    const secondary = (outcome as { issueNumber?: number | null }).issueNumber;
    if (!prNumbers.has(outcome.prNumber) && secondary !== detail.number) continue;
    const openedAt = stamp(outcome.openedAt);
    if (openedAt) items.push({ kind: "pr_opened", ts: openedAt, outcome });
    const terminalAt = stamp(outcome.terminalAt);
    if (terminalAt) items.push({ kind: "pr_closed", ts: terminalAt, outcome });
  }

  const closed = stamp(detail.closedAt);
  if (detail.state === "closed" && closed) items.push({ kind: "issue_closed", ts: closed });

  // Ascending by time; not-yet-started (queued) runs trail at the end —
  // they are the story's next beat, not its past.
  return items.sort((a, b) => {
    if (a.ts === null) return 1;
    if (b.ts === null) return -1;
    return Date.parse(a.ts) - Date.parse(b.ts);
  });
}
