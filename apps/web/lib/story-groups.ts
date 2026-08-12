import type { PipelinePullRequest, PipelineStory } from "./api";

export type PullRequestStoryGroup<Story extends Pick<PipelineStory, "repoId" | "prs">> = {
  key: string;
  pull: PipelinePullRequest;
  stories: Story[];
};

/**
 * Review happens once per pull request even when that change carries several
 * stories. Preserve pipeline order while collecting every affected story.
 */
export function groupStoriesByPullRequest<
  Story extends Pick<PipelineStory, "repoId" | "prs">,
>(
  stories: Story[],
  include: (pull: PipelinePullRequest) => boolean,
): PullRequestStoryGroup<Story>[] {
  const groups = new Map<string, PullRequestStoryGroup<Story>>();

  for (const story of stories) {
    for (const pull of story.prs) {
      if (!include(pull)) continue;
      const key = `${story.repoId}:${pull.number}`;
      const group = groups.get(key);
      if (group) {
        group.stories.push(story);
      } else {
        groups.set(key, { key, pull, stories: [story] });
      }
    }
  }

  return [...groups.values()];
}

export function reviewPullRequestGroups<Story extends Pick<PipelineStory, "repoId" | "prs">>(
  stories: Story[],
) {
  return groupStoriesByPullRequest(stories, (pull) => pull.state === "open" && !pull.draft);
}
