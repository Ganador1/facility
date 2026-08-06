import { cx, StatusDot } from "@facility/ui";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  type PipelineStage,
  type PipelineStageKind,
  type PipelineStory,
  storyHref,
} from "@/lib/pipeline";

const KIND_BORDER: Record<PipelineStageKind, string> = {
  human: "border-t-(--human)",
  agent: "border-t-(--line-strong)",
  machine: "border-t-(--info)",
  done: "border-t-(--ok)",
};

const KIND_COUNT_TONE: Record<PipelineStageKind, string> = {
  human: "text-(--human)",
  agent: "text-(--ink)",
  machine: "text-(--info)",
  done: "text-(--ink)",
};

const KIND_DOT: Record<PipelineStageKind, (count: number) => ReactNode> = {
  human: () => <StatusDot tone="human" />,
  agent: (count) => <StatusDot tone={count > 0 ? "agent" : "machine"} pulse={count > 0} />,
  machine: () => <StatusDot tone="machine" />,
  done: () => <StatusDot tone="ok" />,
};

function countTone(kind: PipelineStageKind, count: number) {
  return count === 0 ? "text-(--dim)" : KIND_COUNT_TONE[kind];
}

/** The current run is the only run that explains a story's live placement. */
export function RunStateDot({ story }: { story: PipelineStory }) {
  if (story.runState === "failed") return <StatusDot tone="bad" />;
  if (story.runState === "live") return <StatusDot tone="agent" pulse />;
  return null;
}

/** The full board: one server-classified column per stage. */
export function PipelineBoard({
  stages,
  projectId,
}: {
  stages: PipelineStage[];
  projectId?: string;
}) {
  return (
    <div className="grid grid-cols-2 border border-(--line) md:grid-cols-4 xl:grid-cols-7">
      {stages.map((stage) => {
        const header = (
          <div className="flex flex-col gap-0.5">
            <div className="flex items-baseline gap-2">
              <span
                className={cx(
                  "font-mono text-[20px] font-semibold leading-none",
                  countTone(stage.kind, stage.count),
                )}
              >
                {stage.count}
              </span>
              <span className="text-[12px] font-medium text-(--ink)">{stage.label}</span>
              {KIND_DOT[stage.kind](stage.count)}
            </div>
            <span className="text-[10.5px] leading-snug text-(--dim)">{stage.sub}</span>
          </div>
        );
        return (
          <div
            key={stage.key}
            className={cx(
              "-ml-px flex min-h-[132px] flex-col gap-3 border-l border-t-2 border-l-(--line) p-4",
              KIND_BORDER[stage.kind],
            )}
          >
            {projectId ? (
              <Link
                href={`/projects/${projectId}/stories?stage=${stage.key}`}
                className="transition-opacity hover:opacity-80"
              >
                {header}
              </Link>
            ) : (
              header
            )}
            <div className="flex flex-col gap-1.5">
              {stage.stories.slice(0, 3).map((story) => (
                <span key={story.key} className="flex min-w-0 items-center gap-1.5">
                  <RunStateDot story={story} />
                  {projectId ? (
                    <Link
                      href={storyHref(projectId, story)}
                      className="min-w-0 truncate text-[11.5px] leading-snug text-(--mut) underline-offset-4 hover:text-(--ink) hover:underline"
                      title={story.title}
                    >
                      <span className="font-mono text-(--dim)">#{story.number}</span> {story.title}
                    </Link>
                  ) : (
                    <a
                      href={story.htmlUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="min-w-0 truncate text-[11.5px] leading-snug text-(--mut) underline-offset-4 hover:text-(--ink) hover:underline"
                      title={story.title}
                    >
                      <span className="font-mono text-(--dim)">#{story.number}</span> {story.title}
                    </a>
                  )}
                  {story.ciState === "failure" && story.ciUrl ? (
                    <a
                      href={story.ciUrl}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="checks failed; open GitHub checks"
                      className="shrink-0 font-mono text-[10px] text-(--bad) hover:underline"
                    >
                      <span aria-hidden="true">■</span> checks · failed
                    </a>
                  ) : null}
                </span>
              ))}
              {stage.stories.length > 3 ? (
                <span className="text-[10.5px] text-(--dim)">+{stage.stories.length - 3} more</span>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** One-line pipeline summary for project cards: the same server model, compressed. */
export function PipelineStrip({ stages }: { stages: PipelineStage[] }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 font-mono text-[10.5px]">
      {stages.map((stage) => (
        <span key={stage.key} className="inline-flex items-baseline gap-1">
          <span className={countTone(stage.kind, stage.count)}>
            {stage.count === 0 ? "–" : stage.count}
          </span>
          <span className="text-(--dim)">{stage.label.toLowerCase()}</span>
        </span>
      ))}
    </div>
  );
}
