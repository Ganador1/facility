import { cx, Eyebrow, StatusDot } from "@facility/ui";
import Link from "next/link";
import { IssueRow } from "@/components/issues/issue-row";
import { ReviewQueue } from "@/components/issues/review-queue";
import { SyncIssuesButton } from "@/components/issues/sync-button";
import { ErrorNotice, Offline } from "@/components/offline";
import { PipelineBoard } from "@/components/project/pipeline";
import { LiveRefresh } from "@/components/shell/live-refresh";
import { api } from "@/lib/api";
import type {
  PipelineStage,
  PipelineStageKey,
  PipelineStageState,
  PipelineStory,
} from "@/lib/pipeline";
import {
  pipelineStageDescription,
  pipelineStageStateDescription,
  pipelineStageSummaries,
  pipelineStories,
} from "@/lib/pipeline";

export const metadata = { title: "stories" };

function hasPermission(permissions: string[], permission: string) {
  const [resource] = permission.split(":");
  return permissions.some((candidate) => ["*", permission, `${resource}:*`].includes(candidate));
}

function StageWorkspace({
  projectId,
  stage,
  activeStatus,
  canTrigger,
}: {
  projectId: string;
  stage: PipelineStage;
  activeStatus: PipelineStageState | null;
  canTrigger: boolean;
}) {
  const summaries = pipelineStageSummaries(stage);
  const visibleSummaries = activeStatus
    ? summaries.filter((summary) => summary.state === activeStatus)
    : summaries;

  return (
    <div className="flex flex-col gap-8">
      {summaries.length > 0 ? (
        <nav
          aria-label={`${stage.label} statuses`}
          className={cx(
            "grid w-full grid-cols-1 border border-(--line)",
            summaries.length === 1 && "sm:max-w-lg",
            summaries.length === 2 && "sm:max-w-4xl sm:grid-cols-2",
            summaries.length === 3 && "sm:grid-cols-3",
            summaries.length >= 4 && "sm:grid-cols-2 xl:grid-cols-4",
          )}
        >
          {summaries.map((summary) => {
            const selected = activeStatus === summary.state;
            return (
              <Link
                key={summary.state}
                href={
                  selected
                    ? `/projects/${projectId}/stories?stage=${stage.key}`
                    : `/projects/${projectId}/stories?stage=${stage.key}&status=${summary.state}`
                }
                aria-current={selected ? "page" : undefined}
                className={cx(
                  "-ml-px -mt-px flex min-h-24 flex-col justify-between gap-3 border border-(--line) p-4 transition-colors hover:bg-(--card)",
                  selected && "border-(--line-strong) bg-(--card)",
                )}
              >
                <div className="flex items-center gap-2">
                  <StatusDot
                    tone={summary.tone}
                    pulse={summary.state === "in_progress" || summary.state === "checks_running"}
                  />
                  <span className="text-[12.5px] font-medium text-(--ink)">{summary.label}</span>
                  <span className="ml-auto font-mono text-[17px] font-semibold text-(--ink)">
                    {summary.count}
                  </span>
                </div>
                <span className="text-[11px] leading-relaxed text-(--dim)">
                  {pipelineStageStateDescription(summary.state)}
                </span>
              </Link>
            );
          })}
        </nav>
      ) : null}

      {visibleSummaries.length === 0 ? (
        <p className="max-w-lg text-sm leading-relaxed text-(--dim)">
          Nothing is in {stage.label.toLowerCase()} right now.
        </p>
      ) : (
        <div className="flex flex-col gap-8">
          {visibleSummaries.map((summary) => {
            const stories = stage.stories.filter((story) => story.stageState === summary.state);
            return (
              <section key={summary.state} className="flex flex-col gap-3">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <StatusDot
                    tone={summary.tone}
                    pulse={summary.state === "in_progress" || summary.state === "checks_running"}
                  />
                  <h2 className="text-[14px] font-semibold tracking-tight">{summary.label}</h2>
                  <span className="font-mono text-[11px] text-(--dim)">{stories.length}</span>
                  <span className="text-[11.5px] text-(--dim)">
                    {pipelineStageStateDescription(summary.state)}
                  </span>
                </div>
                {stage.key === "review" && summary.state === "awaiting_review" ? (
                  <ReviewQueue projectId={projectId} stories={stories} canTrigger={canTrigger} />
                ) : (
                  <StoryQueue
                    projectId={projectId}
                    stage={stage.key}
                    stories={stories}
                    canTrigger={canTrigger}
                  />
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StoryQueue({
  projectId,
  stage,
  stories,
  canTrigger,
}: {
  projectId: string;
  stage: PipelineStageKey;
  stories: PipelineStory[];
  canTrigger: boolean;
}) {
  return (
    <div className="flex flex-col border border-(--line)">
      {stories.map((story) => (
        <IssueRow
          key={story.key}
          projectId={projectId}
          story={story}
          canTrigger={canTrigger}
          stage={stage}
        />
      ))}
    </div>
  );
}

export default async function ProjectStoriesPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ stage?: string; status?: string }>;
}) {
  const [{ projectId }, requested] = await Promise.all([params, searchParams]);
  const [pipelineResult, me] = await Promise.all([api.pipeline(projectId), api.me()]);

  if (!pipelineResult.ok && pipelineResult.offline) return <Offline />;

  const permissions = me.ok ? me.data.permissions : [];
  const canTrigger = hasPermission(permissions, "runs:trigger");
  const canSync = hasPermission(permissions, "repos:write");
  const stages = pipelineResult.ok ? pipelineResult.data.stages : [];
  const activeStage = stages.find((candidate) => candidate.key === requested.stage) ?? null;
  const activeStatus =
    activeStage &&
    requested.status &&
    activeStage.stories.some((story) => story.stageState === requested.status)
      ? (requested.status as PipelineStageState)
      : null;
  const stories = pipelineResult.ok ? pipelineStories(pipelineResult.data) : [];
  const openCount = stories.filter((story) => story.state === "open").length;

  return (
    <div className="flex flex-col gap-8">
      <LiveRefresh seconds={30} />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex max-w-3xl flex-col gap-2">
          <Eyebrow>{activeStage ? `stories / ${activeStage.key}` : "stories"}</Eyebrow>
          <h1 className="text-[clamp(22px,3vw,32px)] font-semibold tracking-tight">
            {activeStage?.label ?? "Stories"}
          </h1>
          <p className="text-[12.5px] leading-relaxed text-(--dim)">
            {!pipelineResult.ok
              ? "Pipeline unavailable"
              : activeStage
                ? `${activeStage.count} ${activeStage.count === 1 ? "story" : "stories"} · ${pipelineStageDescription(activeStage.key)}`
                : `${openCount} open stories · lifecycle orientation and queues that need action.`}
          </p>
        </div>
        {canSync ? <SyncIssuesButton projectId={projectId} /> : null}
      </div>

      {!pipelineResult.ok ? (
        <ErrorNotice
          message={
            pipelineResult.status === 404
              ? "The story pipeline isn't available on this control plane yet."
              : `Couldn't load stories — ${pipelineResult.message}`
          }
        />
      ) : activeStage ? (
        <StageWorkspace
          projectId={projectId}
          stage={activeStage}
          activeStatus={activeStatus}
          canTrigger={canTrigger}
        />
      ) : (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="text-[14px] font-semibold tracking-tight">Lifecycle</h2>
            <span className="text-[11.5px] text-(--dim)">
              Choose a stage to enter its working context.
            </span>
          </div>
          <PipelineBoard stages={stages} projectId={projectId} />
        </section>
      )}
    </div>
  );
}
