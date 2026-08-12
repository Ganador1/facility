import type { PipelineStageKey } from "./api";

export type StoryNavigationItem = {
  href: string;
  label: string;
  stage?: PipelineStageKey;
};

/** The durable lifecycle is navigation; transient conditions live inside each stage. */
export const STORY_STAGES = [
  { stage: "backlog", label: "Backlog" },
  { stage: "planning", label: "Planning" },
  { stage: "building", label: "Building" },
  { stage: "validating", label: "Validating" },
  { stage: "review", label: "Review" },
  { stage: "shipped", label: "Shipped" },
] as const satisfies ReadonlyArray<{ stage: PipelineStageKey; label: string }>;

export function storyNavigation(projectId: string): StoryNavigationItem[] {
  const base = `/projects/${projectId}/stories`;
  return [
    { href: base, label: "Overview" },
    ...STORY_STAGES.map(({ stage, label }) => ({
      href: `${base}?stage=${stage}`,
      label,
      stage,
    })),
  ];
}
