import { cx, Eyebrow, StatusDot } from "@facility/ui";
import Link from "next/link";
import type { GhIssue } from "@/components/issues/issue-row";
import { IssueRow } from "@/components/issues/issue-row";
import { SyncIssuesButton } from "@/components/issues/sync-button";
import { ErrorNotice, Offline } from "@/components/offline";
import { StageSection } from "@/components/project/stage-section";
import { LiveRefresh } from "@/components/shell/live-refresh";
import { api } from "@/lib/api";
import {
  classifyPipeline,
  PIPELINE_STAGES,
  type PipelineStage,
  pipelineCounts,
} from "@/lib/pipeline";
import { fetchAllProjectIssues } from "@/lib/project-issues";

export const metadata = { title: "pipeline" };

/** The list reads delivery-first: what's closest to shipping sits on top. */
const DELIVERY_FIRST = [...PIPELINE_STAGES].reverse();

function hasPermission(permissions: string[], permission: string) {
  const [resource] = permission.split(":");
  return permissions.some((p) => p === "*" || p === permission || p === `${resource}:*`);
}

const STAGE_KEYS = new Set(PIPELINE_STAGES.map((s) => s.key));

export default async function ProjectPipelinePage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ stage?: string }>;
}) {
  const [{ projectId }, { stage }] = await Promise.all([params, searchParams]);
  const activeStage =
    stage && STAGE_KEYS.has(stage as PipelineStage) ? (stage as PipelineStage) : null;
  const [issues, me, inbox] = await Promise.all([
    fetchAllProjectIssues<GhIssue>(projectId),
    api.me(),
    api.inboxFull(),
  ]);

  if (!issues.ok && issues.offline) return <Offline />;

  const permissions = me.ok ? me.data.permissions : [];
  const canTrigger = hasPermission(permissions, "runs:trigger");
  const canSync = hasPermission(permissions, "repos:write");
  const items = issues.ok ? issues.items : [];
  const proposals = inbox.ok
    ? inbox.data.proposals.filter((x) => !x.projectId || x.projectId === projectId)
    : [];
  const stages = classifyPipeline(items, proposals);
  const counts = [...pipelineCounts(stages)].reverse();
  const openCount = items.filter((i) => i.state === "open").length;

  const visibleStages = activeStage
    ? DELIVERY_FIRST.filter((s) => s.key === activeStage)
    : DELIVERY_FIRST;

  return (
    <div className="flex flex-col gap-8">
      <LiveRefresh seconds={30} />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Eyebrow>pipeline</Eyebrow>
          <h1 className="text-[clamp(22px,3vw,32px)] font-semibold tracking-tight">Pipeline</h1>
          <p className="text-[12.5px] text-(--dim)">
            {issues.ok ? `${openCount} open issues · closest to shipping on top` : "mirror unavailable"} ·
            issues live on GitHub — agents are dispatched here
          </p>
        </div>
        {canSync ? <SyncIssuesButton projectId={projectId} /> : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={`/projects/${projectId}/issues`}
          className={cx(
            "border px-3 py-1.5 text-[12px] font-medium transition-colors",
            !activeStage
              ? "border-(--line-strong) text-(--ink)"
              : "border-(--line) text-(--mut) hover:text-(--ink)",
          )}
        >
          all
        </Link>
        {counts.map((s) => (
          <Link
            key={s.key}
            href={`/projects/${projectId}/issues?stage=${s.key}`}
            className={cx(
              "inline-flex items-center gap-2 border px-3 py-1.5 text-[12px] font-medium transition-colors",
              activeStage === s.key
                ? "border-(--line-strong) text-(--ink)"
                : "border-(--line) text-(--mut) hover:text-(--ink)",
            )}
          >
            {s.kind === "human" ? <StatusDot tone="human" /> : null}
            {s.label}
            <span
              className={cx(
                "font-mono text-[11px]",
                s.count > 0
                  ? s.kind === "human"
                    ? "text-(--human)"
                    : "text-(--ink)"
                  : "text-(--dim)",
              )}
            >
              {s.count}
            </span>
          </Link>
        ))}
      </div>

      {!issues.ok ? (
        <ErrorNotice
          message={
            issues.status === 404
              ? "The issue mirror isn't available on this control plane yet."
              : `Couldn't load issues — ${issues.message}`
          }
        />
      ) : items.length === 0 ? (
        <p className="max-w-lg text-sm leading-relaxed text-(--dim)">
          Nothing mirrored yet. Issues sync from the connected repository automatically; use sync to
          backfill.
        </p>
      ) : (
        <div className="flex flex-col gap-6">
          {visibleStages.map((s) => {
            const stageItems = stages.get(s.key) ?? [];
            return (
              <StageSection
                key={s.key}
                label={s.label}
                sub={s.sub}
                kind={s.kind}
                total={stageItems.length}
                liveCount={stageItems.filter((p) => p.runState === "live").length}
                failedCount={stageItems.filter((p) => p.runState === "failed").length}
                defaultOpen={activeStage !== null || s.key !== "shipped"}
              >
                {stageItems.length === 0 ? (
                  <p className="border border-(--line) px-5 py-3.5 text-[12.5px] text-(--dim)">
                    Nothing here right now.
                  </p>
                ) : (
                  <div className="flex flex-col border border-(--line)">
                    {stageItems.map((placed) => (
                      <IssueRow
                        key={placed.issue.number}
                        projectId={projectId}
                        issue={placed.issue}
                        canTrigger={canTrigger}
                      />
                    ))}
                  </div>
                )}
              </StageSection>
            );
          })}
        </div>
      )}
    </div>
  );
}
