import { StatusDot, toneFor } from "@facility/ui";
import Link from "next/link";
import { ProposalCard } from "@/components/inbox/proposal-card";
import type { Proposal } from "@/lib/api";
import { fmtCost, fmtDuration } from "@/lib/runs";
import type { StoryItem, StoryRun } from "@/lib/story";

/**
 * The story timeline: everything that happened to a unit of work, in order,
 * with the next pending human decision actionable inline (embedded proposal
 * cards). Server component — the interactive pieces are client children.
 */
export function StoryTimeline({
  projectId,
  items,
  canDecide,
}: {
  projectId: string;
  items: StoryItem[];
  canDecide: boolean;
}) {
  if (items.length === 0) {
    return (
      <p className="text-[12.5px] text-(--dim)">
        Nothing recorded yet — dispatch an architect to start this story.
      </p>
    );
  }
  return (
    <ol className="flex flex-col border-l border-(--line)">
      {items.map((item, index) => (
        <li
          key={`${item.kind}-${index}-${item.kind === "run" ? item.run.id : (item.ts ?? "")}`}
          className="relative pb-6 pl-6 last:pb-0"
        >
          <span
            aria-hidden
            className="absolute top-1.5 -left-[3.5px] h-[7px] w-[7px] border border-(--line-strong) bg-(--bg)"
          />
          <TimelineItem projectId={projectId} item={item} canDecide={canDecide} />
        </li>
      ))}
    </ol>
  );
}

function TimelineItem({
  projectId,
  item,
  canDecide,
}: {
  projectId: string;
  item: StoryItem;
  canDecide: boolean;
}) {
  switch (item.kind) {
    case "issue_opened":
      return (
        <MilestoneLine
          ts={item.ts}
          text={`issue opened${item.author ? ` by ${item.author}` : ""}`}
        />
      );
    case "issue_closed":
      return <MilestoneLine ts={item.ts} text="issue closed" tone="ok" />;
    case "run":
      return <RunItem projectId={projectId} ts={item.ts} run={item.run} />;
    case "proposal":
      return item.proposal.state === "open" ? (
        // The actionable beat: the pending gate, decidable right here.
        <div className="flex flex-col gap-2">
          <MilestoneLine ts={item.ts} text="waiting on you" tone="human" />
          {canDecide ? (
            <ProposalCard proposal={item.proposal} />
          ) : (
            <p className="text-[12px] text-(--dim)">
              {humanizeAction(item.proposal.actionType)} — awaiting a decision
            </p>
          )}
        </div>
      ) : (
        <MilestoneLine
          ts={item.ts}
          text={`${humanizeAction(item.proposal.actionType)} proposed`}
          tone="human"
        />
      );
    case "proposal_decided":
      return (
        <MilestoneLine
          ts={item.ts}
          text={`${humanizeAction(item.proposal.actionType)} ${decisionOf(item.proposal)}${decidedByOf(item.proposal)}`}
          tone={item.proposal.state === "rejected" ? "bad" : "ok"}
        />
      );
    case "pr_opened":
      return (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <StatusDot tone="agent" />
          <a
            href={`https://github.com/${item.outcome.repo}/pull/${item.outcome.prNumber}`}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-[12.5px] text-(--ink) underline-offset-4 hover:underline"
          >
            PR {item.outcome.repo.split("/")[1]}#{item.outcome.prNumber} ↗
          </a>
          <span className="text-[12px] text-(--mut)">opened · {item.outcome.agentLane}</span>
          <Stamp ts={item.ts} />
        </div>
      );
    case "pr_closed":
      return (
        <MilestoneLine
          ts={item.ts}
          text={`PR #${item.outcome.prNumber} ${item.outcome.fate ?? "closed"}${
            item.outcome.reviewRounds > 0
              ? ` · ${item.outcome.reviewRounds} review round${item.outcome.reviewRounds === 1 ? "" : "s"}`
              : ""
          }`}
          tone={item.outcome.fate === "merged" ? "ok" : "machine"}
        />
      );
    default:
      return null;
  }
}

function RunItem({ projectId, ts, run }: { projectId: string; ts: string | null; run: StoryRun }) {
  const cost = costOf(run);
  const failed = run.status === "failed";
  return (
    <div className="flex flex-col gap-1 border border-(--line) bg-(--bg-subtle) px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <StatusDot tone={toneFor(run.status)} pulse={run.status === "running"} />
        <Link
          href={`/projects/${projectId}/sessions/${run.id}`}
          className="font-mono text-[12.5px] text-(--ink) underline-offset-4 hover:underline"
        >
          {run.mode}
        </Link>
        <span className={`text-[12px] ${failed ? "text-(--bad)" : "text-(--mut)"}`}>
          {run.status}
        </span>
        <span className="font-mono text-[10.5px] text-(--dim)">{run.engine}</span>
        {run.startedAt ? (
          <span className="font-mono text-[10.5px] text-(--dim)">
            {fmtDuration(String(run.startedAt), run.endedAt ? String(run.endedAt) : null)}
          </span>
        ) : null}
        {cost ? <span className="font-mono text-[10.5px] text-(--dim)">{cost}</span> : null}
        <span className="ml-auto">
          <Stamp ts={ts} fallback="queued" />
        </span>
      </div>
    </div>
  );
}

function MilestoneLine({
  ts,
  text,
  tone = "machine",
}: {
  ts: string | null;
  text: string;
  tone?: "ok" | "bad" | "human" | "machine";
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <StatusDot tone={tone} />
      <span className="text-[12.5px] text-(--mut)">{text}</span>
      <Stamp ts={ts} />
    </div>
  );
}

function Stamp({ ts, fallback = "" }: { ts: string | null; fallback?: string }) {
  if (!ts)
    return fallback ? (
      <span className="font-mono text-[10.5px] text-(--dim)">{fallback}</span>
    ) : null;
  return (
    <time dateTime={ts} className="font-mono text-[10.5px] text-(--dim)">
      {ts.slice(0, 16).replace("T", " ")}
    </time>
  );
}

function humanizeAction(actionType: string | undefined): string {
  if (!actionType) return "proposal";
  if (actionType === "plan_acceptance") return "plan approval";
  return actionType.replaceAll("_", " ");
}

function decisionOf(proposal: Proposal): string {
  if (proposal.state === "rejected") return "rejected";
  if (proposal.state === "execution_failed") return "approved · execution failed";
  return proposal.state === "approved" ? "approved" : proposal.state;
}

function decidedByOf(proposal: Proposal): string {
  const by = (proposal as { decidedBy?: { id?: string } | null }).decidedBy;
  return by?.id ? ` · by ${by.id}` : "";
}

function costOf(run: StoryRun): string | null {
  const receipt = run.receipt as { usage?: { cost_cents?: number } } | null;
  const cents = receipt?.usage?.cost_cents;
  return typeof cents === "number" && cents > 0 ? fmtCost(cents) : null;
}
