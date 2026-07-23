import { Eyebrow, PillTag, StatusDot } from "@facility/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Markdown } from "@/components/markdown";
import { ErrorNotice, Offline } from "@/components/offline";
import { LiveRefresh } from "@/components/shell/live-refresh";
import { StoryTimeline } from "@/components/story/timeline";
import { StoryTriggerButtons } from "@/components/story/trigger-buttons";
import { api } from "@/lib/api";
import { classifyPipeline, PIPELINE_STAGES } from "@/lib/pipeline";
import { asPipelineIssue, deriveStoryTimeline, proposalsForIssue } from "@/lib/story";

export async function generateMetadata({ params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  return { title: `story #${number}` };
}

/**
 * The story page: one unit of work, its whole life — issue, agent runs,
 * human gates, PRs — as a single actionable timeline. GitHub is the sync
 * reference (the ↗ link), not the destination.
 */
export default async function StoryPage({
  params,
}: {
  params: Promise<{ projectId: string; number: string }>;
}) {
  const { projectId, number: rawNumber } = await params;
  const number = Number.parseInt(rawNumber, 10);
  if (!Number.isFinite(number)) notFound();

  const [detail, inbox, outcomes, me] = await Promise.all([
    api.issue(projectId, number),
    api.inboxAll(),
    api.outcomes(`?state=all&projectId=${projectId}&limit=200`),
    api.me(),
  ]);

  if (!detail.ok) {
    if (detail.offline) return <Offline />;
    if (detail.status === 404) notFound();
    return <ErrorNotice message={`Couldn't load this story — ${detail.message}`} />;
  }

  const issue = detail.data;
  const proposals = (inbox.ok ? inbox.data : []).filter(
    (proposal) => proposal.projectId === projectId,
  );
  const storyProposals = proposalsForIssue(proposals, number);
  const openProposals = proposals.filter((proposal) => proposal.state === "open");
  const timeline = deriveStoryTimeline({
    detail: issue,
    proposals,
    outcomes: outcomes.ok ? outcomes.data : [],
  });

  const staged = classifyPipeline([asPipelineIssue(issue)], openProposals);
  const stage = PIPELINE_STAGES.find((candidate) =>
    (staged.get(candidate.key) ?? []).some((placed) => placed.issue.number === number),
  );

  const permissions = me.ok ? me.data.permissions : [];
  const has = (perm: string) =>
    permissions.some((p) => p === "*" || p === perm || p === `${perm.split(":")[0]}:*`);
  const labels = Array.isArray(issue.labels) ? (issue.labels as string[]) : [];

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8">
      <LiveRefresh seconds={15} />

      <div className="flex flex-col gap-3">
        <Eyebrow>story</Eyebrow>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <h1 className="min-w-0 text-[clamp(18px,2.4vw,26px)] font-semibold tracking-tight">
            <span className="mr-3 font-mono text-[0.72em] text-(--dim)">#{issue.number}</span>
            {issue.title}
          </h1>
          {has("runs:trigger") && issue.state === "open" ? (
            <StoryTriggerButtons projectId={projectId} issueNumber={issue.number} />
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="flex items-center gap-2">
            <StatusDot tone={issue.state === "open" ? "human" : "ok"} />
            <span className="text-[12px] font-medium text-(--mut)">{issue.state}</span>
          </span>
          {stage ? <PillTag>{stage.label}</PillTag> : null}
          {labels.slice(0, 4).map((label) => (
            <span
              key={label}
              className="border border-(--line) px-1.5 py-0.5 font-mono text-[10px] text-(--dim)"
            >
              {label}
            </span>
          ))}
          <a
            href={issue.htmlUrl}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-[11px] text-(--mut) underline-offset-4 hover:text-(--ink) hover:underline"
          >
            GitHub ↗
          </a>
          {storyProposals.some((proposal) => proposal.state === "open") ? (
            <span className="font-mono text-[11px] text-(--human)">waiting on you</span>
          ) : null}
        </div>
      </div>

      {issue.bodyMd?.trim() ? (
        <details className="border border-(--line) bg-(--bg-subtle)">
          <summary className="cursor-pointer px-4 py-2.5 font-mono text-[11px] text-(--dim) hover:text-(--ink)">
            issue body
          </summary>
          <div className="border-t border-(--line) px-5 py-4">
            <Markdown source={issue.bodyMd} />
          </div>
        </details>
      ) : null}

      <div className="flex flex-col gap-4">
        <Eyebrow>timeline</Eyebrow>
        <StoryTimeline projectId={projectId} items={timeline} canDecide={has("hitl:decide")} />
      </div>

      <p className="text-[11.5px] text-(--dim)">
        <Link
          href={`/projects/${projectId}/stories`}
          className="underline-offset-4 hover:underline"
        >
          ← all stories
        </Link>
      </p>
    </div>
  );
}
