import { describe, expect, it } from "vitest";
import type { PipelineStory } from "@/lib/api";
import { reviewPullRequestGroups } from "@/lib/story-groups";

describe("story review groups", () => {
  it("represents a shared pull request as one review action", () => {
    const pull = pullRequest(1035);
    const groups = reviewPullRequestGroups([
      story("repo-1", 1085, [pull]),
      story("repo-1", 1084, [pull]),
      story("repo-1", 1083, [pull]),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      key: "repo-1:1035",
      pull: { number: 1035 },
    });
    expect(groups[0]?.stories.map(({ number }) => number)).toEqual([1085, 1084, 1083]);
  });

  it("keeps same-number pull requests from different repositories separate", () => {
    const groups = reviewPullRequestGroups([
      story("repo-1", 1, [pullRequest(17)]),
      story("repo-2", 2, [pullRequest(17)]),
    ]);

    expect(groups.map(({ key }) => key)).toEqual(["repo-1:17", "repo-2:17"]);
  });

  it("omits drafts and closed pull requests from the human review queue", () => {
    const groups = reviewPullRequestGroups([
      story("repo-1", 1, [
        pullRequest(10, { draft: true }),
        pullRequest(11, { state: "closed" }),
        pullRequest(12),
      ]),
    ]);

    expect(groups.map(({ pull }) => pull.number)).toEqual([12]);
  });
});

function story(repoId: string, number: number, prs: PipelineStory["prs"]): PipelineStory {
  return { repoId, number, prs } as PipelineStory;
}

function pullRequest(
  number: number,
  overrides: Partial<PipelineStory["prs"][number]> = {},
): PipelineStory["prs"][number] {
  return {
    number,
    title: `PR ${number}`,
    url: `https://github.test/octo/repo/pull/${number}`,
    state: "open",
    draft: false,
    headSha: `head-${number}`,
    ciState: "success",
    ciHeadSha: `head-${number}`,
    createdAt: "2026-08-12T09:00:00Z",
    closedAt: null,
    mergedAt: null,
    ...overrides,
  };
}
