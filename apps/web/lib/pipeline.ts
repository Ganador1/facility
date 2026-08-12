import type {
  Pipeline,
  PipelineStage,
  PipelineStageKey,
  PipelineStageState,
  PipelineStory,
} from "./api";

export type {
  Pipeline,
  PipelineStage,
  PipelineStageKey,
  PipelineStageKind,
  PipelineStageState,
  PipelineStory,
} from "./api";

export type PipelineStatusTone = "human" | "agent" | "machine" | "bad" | "ok";

const STATUS_ORDER: Record<PipelineStageKey, PipelineStageState[]> = {
  backlog: ["needs_attention", "ready_to_plan"],
  planning: ["in_progress", "needs_review", "ready_to_build", "failed"],
  building: ["in_progress", "draft_pr", "failed"],
  validating: ["checks_running", "checks_failed"],
  review: ["in_progress", "awaiting_review", "failed"],
  shipped: ["shipped_recently"],
};

const STAGE_DESCRIPTION: Record<PipelineStageKey, string> = {
  backlog: "Choose what deserves planning. Priority and product context matter here.",
  planning: "Shape the approach, resolve open decisions, and approve plans for building.",
  building: "Follow active implementation, drafts, and work that needs intervention.",
  validating: "Use check evidence to decide whether a change is ready for human review.",
  review: "Review each pull request once, including every story it delivers.",
  shipped: "See what reached the product recently and trace it back to its stories.",
};

const STATUS_DESCRIPTION: Record<PipelineStageState, string> = {
  ready_to_plan: "Unstarted stories that can be sent to the architect.",
  needs_attention: "Earlier activity stopped without producing a usable plan.",
  in_progress: "An agent is actively working on these stories.",
  needs_review: "Plans waiting for a human decision before implementation.",
  ready_to_build: "Approved plans that can be sent to the builder.",
  failed: "Agent work that stopped and needs inspection or another attempt.",
  draft_pr: "Implementation has produced a draft change that is still being worked.",
  checks_running: "Pull requests whose current-head checks have not finished.",
  checks_failed: "Pull requests whose current-head checks need investigation.",
  awaiting_review: "Pull requests ready for a human review and merge decision.",
  shipped_recently: "Stories merged during the last seven days.",
};

const STATUS_TONE: Record<PipelineStageState, PipelineStatusTone> = {
  ready_to_plan: "human",
  needs_attention: "bad",
  in_progress: "agent",
  needs_review: "human",
  ready_to_build: "agent",
  failed: "bad",
  draft_pr: "machine",
  checks_running: "machine",
  checks_failed: "bad",
  awaiting_review: "human",
  shipped_recently: "ok",
};

export function pipelineStageStateLabel(
  stage: PipelineStageKey,
  state: PipelineStageState,
  count: number,
) {
  switch (state) {
    case "ready_to_plan":
      return "Ready to plan";
    case "needs_attention":
      return "Need attention";
    case "in_progress":
      return "In progress";
    case "needs_review":
      return "Need plan review";
    case "ready_to_build":
      return "Ready to build";
    case "failed":
      if (stage === "planning") return count === 1 ? "Plan failed" : "Plans failed";
      if (stage === "building") return count === 1 ? "Build failed" : "Builds failed";
      return count === 1 ? "Review failed" : "Reviews failed";
    case "draft_pr":
      return count === 1 ? "Draft PR" : "Draft PRs";
    case "checks_running":
      return "Checks running";
    case "checks_failed":
      return "Checks failed";
    case "awaiting_review":
      return "Awaiting your review";
    case "shipped_recently":
      return "Shipped this week";
  }
}

export function pipelineStageStateTone(state: PipelineStageState) {
  return STATUS_TONE[state];
}

export function pipelineStageDescription(stage: PipelineStageKey) {
  return STAGE_DESCRIPTION[stage];
}

export function pipelineStageStateDescription(state: PipelineStageState) {
  return STATUS_DESCRIPTION[state];
}

export function pipelineStageStates(stage: PipelineStageKey) {
  return [...STATUS_ORDER[stage]];
}

export function pipelineStageSummaries(stage: PipelineStage) {
  const countByState = new Map<PipelineStageState, number>();
  for (const story of stage.stories) {
    countByState.set(story.stageState, (countByState.get(story.stageState) ?? 0) + 1);
  }
  return STATUS_ORDER[stage.key]
    .map((state) => ({
      state,
      count: countByState.get(state) ?? 0,
      label: pipelineStageStateLabel(stage.key, state, countByState.get(state) ?? 0),
      tone: pipelineStageStateTone(state),
    }))
    .filter((summary) => summary.count > 0);
}

/** Stable story identity for projects that mirror more than one repository. */
function storyQuery(story: Pick<PipelineStory, "repoId" | "storyType">) {
  return new URLSearchParams({ repoId: story.repoId, storyType: story.storyType }).toString();
}

export function storyHref(
  projectId: string,
  story: Pick<PipelineStory, "number" | "repoId" | "storyType">,
) {
  return `/projects/${projectId}/stories/${story.number}?${storyQuery(story)}`;
}

export function pipelineStories(pipeline: Pipeline): PipelineStory[] {
  return pipeline.stages.flatMap((stage) => stage.stories);
}

/** Open, non-draft pull requests that are genuinely waiting on a human review. */
export function reviewablePullRequests<Story extends Pick<PipelineStory, "repoId" | "prs">>(
  stories: Story[],
) {
  return [
    ...new Map(
      stories.flatMap((story) =>
        story.prs
          .filter((pull) => pull.state === "open" && !pull.draft)
          .map((pull) => [`${story.repoId}:${pull.number}`, { story, pull }] as const),
      ),
    ).values(),
  ];
}
