import { cx, StatusDot } from "@facility/ui";
import Link from "next/link";
import {
  PIPELINE_STAGES,
  type PipelineIssue,
  type PipelineStage,
  type PlacedIssue,
  pipelineCounts,
  type StageKind,
} from "@/lib/pipeline";

/** Human gates get the human (amber) accent; agent stages the working green. */
function kindBorder(kind: StageKind) {
  if (kind === "human") return "border-t-2 border-t-(--human)";
  if (kind === "agent") return "border-t-2 border-t-(--line-strong)";
  return "border-t-2 border-t-(--ok)";
}

function kindDot(kind: StageKind, count: number) {
  if (kind === "human") return <StatusDot tone="human" />;
  if (kind === "agent")
    return <StatusDot tone={count > 0 ? "agent" : "machine"} pulse={count > 0} />;
  return <StatusDot tone="ok" />;
}

function countTone(kind: StageKind, count: number) {
  if (count === 0) return "text-(--dim)";
  if (kind === "human") return "text-(--human)";
  return "text-(--ink)";
}

/** The issue's one-run state, as a dot: red = failed, pulsing = live. */
export function RunStateDot({ placed }: { placed: PlacedIssue }) {
  if (placed.runState === "failed") return <StatusDot tone="bad" />;
  if (placed.runState === "live") return <StatusDot tone="agent" pulse />;
  return null;
}

/** The full board: one column per stage, issues as chips. The product's centerpiece. */
export function PipelineBoard({
  stages,
  projectId,
}: {
  stages: Map<PipelineStage, PlacedIssue[]>;
  projectId?: string;
}) {
  const counts = pipelineCounts(stages);
  return (
    <div className="grid grid-cols-2 border border-(--line) sm:grid-cols-3 lg:grid-cols-6">
      {counts.map((stage, i) => {
        const items = stages.get(stage.key) ?? [];
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
              {kindDot(stage.kind, stage.count)}
            </div>
            <span className="text-[10.5px] leading-snug text-(--dim)">{stage.sub}</span>
          </div>
        );
        return (
          <div
            key={stage.key}
            className={cx(
              "flex min-h-[132px] flex-col gap-3 p-4",
              kindBorder(stage.kind),
              i > 0 && "border-l border-l-(--line)",
              "max-lg:odd:border-l-0 sm:max-lg:[&:nth-child(3n+1)]:border-l-0",
            )}
          >
            {projectId ? (
              <Link
                href={`/projects/${projectId}/issues?stage=${stage.key}`}
                className="transition-opacity hover:opacity-80"
              >
                {header}
              </Link>
            ) : (
              header
            )}
            <div className="flex flex-col gap-1.5">
              {items.slice(0, 3).map((placed) => (
                <span key={placed.issue.number} className="flex items-center gap-1.5">
                  <RunStateDot placed={placed} />
                  <a
                    href={placed.issue.htmlUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="min-w-0 truncate text-[11.5px] leading-snug text-(--mut) underline-offset-4 hover:text-(--ink) hover:underline"
                    title={placed.issue.title}
                  >
                    <span className="font-mono text-(--dim)">#{placed.issue.number}</span>{" "}
                    {placed.issue.title}
                  </a>
                  {placed.prs.map((pr) => (
                    <a
                      key={pr.number}
                      href={pr.url}
                      target="_blank"
                      rel="noreferrer"
                      className="shrink-0 font-mono text-[10.5px] text-(--info,--mut) underline-offset-4 hover:underline"
                    >
                      PR&nbsp;#{pr.number}
                    </a>
                  ))}
                </span>
              ))}
              {items.length > 3 ? (
                <span className="text-[10.5px] text-(--dim)">+{items.length - 3} more</span>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** One-line pipeline summary for project cards: the same model, compressed. */
export function PipelineStrip({
  stages,
}: {
  stages: Map<PipelineStage, PlacedIssue<PipelineIssue>[]>;
}) {
  const counts = pipelineCounts(stages);
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 font-mono text-[10.5px]">
      {counts.map((stage) => (
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
