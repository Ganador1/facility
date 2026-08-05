import type { Pipeline, PipelineStory } from "./api";

export type {
  Pipeline,
  PipelineStage,
  PipelineStageKey,
  PipelineStageKind,
  PipelineStory,
} from "./api";

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
