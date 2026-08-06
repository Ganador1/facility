import { describe, expect, it } from "vitest";
import type { PipelineStageKey, PipelineStory, Proposal, StoryDetail } from "@/lib/api";
import { reviewablePullRequests, storyHref } from "@/lib/pipeline";
import { deriveStoryTimeline, proposalsForStory } from "@/lib/story";

describe("story presentation contract", () => {
  it("keeps repository and story kind in every detail link", () => {
    expect(
      storyHref("project-1", {
        number: 17,
        repoId: "repo-2",
        storyType: "pull_request",
      } as PipelineStory),
    ).toBe("/projects/project-1/stories/17?repoId=repo-2&storyType=pull_request");
  });

  it("renders human-created mirrored PRs without requiring a Facility run or outcome", () => {
    const detail = storyDetail();
    detail.prs = [
      {
        number: 22,
        title: "Human-created PR",
        url: "https://github.test/octo/repo/pull/22",
        state: "merged",
        draft: false,
        headSha: "head-22",
        ciState: "pending",
        ciHeadSha: "head-22",
        createdAt: "2026-08-02T00:00:00Z",
        closedAt: "2026-08-03T00:00:00Z",
        mergedAt: "2026-08-03T00:00:00Z",
      },
    ];
    const timeline = deriveStoryTimeline({
      detail,
      proposals: [],
      outcomes: [],
      comments: [],
      prs: [
        {
          number: 22,
          title: "Human-created PR",
          bodyMd: "Closes #17",
          author: "ada",
          url: "https://github.test/octo/repo/pull/22",
          state: "merged",
          draft: false,
          createdAt: "2026-08-02T00:00:00Z",
          closedAt: "2026-08-03T00:00:00Z",
          mergedAt: "2026-08-03T00:00:00Z",
          ciState: "pending",
        },
      ],
      allowLegacyProposalNumber: true,
      stageLabels: new Map<PipelineStageKey, string>([
        ["validating", "Validating"],
        ["shipped", "Shipped"],
      ]),
    });

    expect(timeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "pr_opened", outcome: null }),
        expect.objectContaining({ kind: "pr_closed", outcome: null }),
        expect.objectContaining({ kind: "stage", stage: "validating", label: "Validating" }),
        expect.objectContaining({ kind: "stage", stage: "shipped", label: "Shipped" }),
      ]),
    );
  });

  it("does not replay stale-head CI as a timeline stage", () => {
    const detail = storyDetail();
    detail.prs = [
      {
        number: 23,
        title: "Updated PR",
        url: "https://github.test/octo/repo/pull/23",
        state: "open",
        draft: false,
        headSha: "new-head",
        ciState: "pending",
        ciHeadSha: "old-head",
        createdAt: "2026-08-02T00:00:00Z",
        closedAt: null,
        mergedAt: null,
      },
    ];
    const timeline = deriveStoryTimeline({
      detail,
      proposals: [],
      outcomes: [],
      comments: [],
      prs: [
        {
          number: 23,
          title: "Updated PR",
          bodyMd: "Body",
          author: "ada",
          url: "https://github.test/octo/repo/pull/23",
          state: "open",
          draft: false,
          createdAt: "2026-08-02T00:00:00Z",
          closedAt: null,
          mergedAt: null,
          ciState: "pending",
        },
      ],
      allowLegacyProposalNumber: true,
      stageLabels: new Map([["validating", "Validating"]]),
    });

    expect(timeline).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "stage", stage: "validating" })]),
    );
  });

  it("falls back to detail PRs and replays draft work as building", () => {
    const detail = storyDetail();
    detail.prs = [pipelinePull(24, { draft: true })];
    const timeline = deriveStoryTimeline({
      detail,
      proposals: [],
      outcomes: [],
      comments: [],
      prs: undefined,
      allowLegacyProposalNumber: true,
      stageLabels: new Map([["building", "Building"]]),
    });

    expect(timeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "pr_opened", outcome: null }),
        expect.objectContaining({ kind: "stage", stage: "building", label: "Building" }),
      ]),
    );
    expect(timeline).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "stage", stage: "review" })]),
    );
  });

  it("uses legacy number-only proposals only when that number is unambiguous", () => {
    const proposal = {
      id: "proposal-1",
      payload: { issueNumber: 17 },
    } as unknown as Proposal;
    expect(proposalsForStory([proposal], storyDetail(), false)).toEqual([]);
    expect(proposalsForStory([proposal], storyDetail(), true)).toEqual([proposal]);
  });

  it("uses the originating run to qualify legacy proposals in multi-repo projects", () => {
    const detail = storyDetail();
    detail.runs = [
      {
        id: "run-17",
        mode: "architect",
        engine: "codex",
        status: "succeeded",
        startedAt: null,
        endedAt: null,
        receipt: null,
        triggeredBy: "ada",
      },
    ];
    const proposal = {
      id: "proposal-run-linked",
      runId: "run-17",
      payload: { issueNumber: 17 },
    } as unknown as Proposal;
    expect(proposalsForStory([proposal], detail, false)).toEqual([proposal]);
  });

  it("keeps run-linked human gates on pull-request stories", () => {
    const detail = storyDetail();
    detail.key = "repo-1:pull_request:22";
    detail.storyType = "pull_request";
    detail.number = 22;
    detail.runs = [
      {
        id: "run-pr-22",
        mode: "architect",
        engine: "codex",
        status: "succeeded",
        startedAt: null,
        endedAt: null,
        receipt: null,
        triggeredBy: "ada",
      },
    ];
    const linked = {
      id: "proposal-pr-run",
      runId: "run-pr-22",
      payload: { issueNumber: 999 },
    } as unknown as Proposal;
    const unrelated = {
      id: "proposal-pr-number",
      payload: { issueNumber: 22, repoId: "repo-1" },
    } as unknown as Proposal;

    expect(proposalsForStory([linked, unrelated], detail, false)).toEqual([linked]);
  });

  it("does not count draft pull requests as waiting for human review", () => {
    const story = storyDetail();
    story.prs = [
      pipelinePull(21, { draft: true }),
      pipelinePull(22),
      pipelinePull(23, { state: "closed" }),
    ];

    expect(reviewablePullRequests([story]).map(({ pull }) => pull.number)).toEqual([22]);
  });
});

function pipelinePull(
  number: number,
  overrides: Partial<StoryDetail["prs"][number]> = {},
): StoryDetail["prs"][number] {
  return {
    number,
    title: `PR ${number}`,
    url: `https://github.test/octo/repo/pull/${number}`,
    state: "open",
    draft: false,
    headSha: `head-${number}`,
    ciState: null,
    ciHeadSha: null,
    createdAt: "2026-08-02T00:00:00Z",
    closedAt: null,
    mergedAt: null,
    ...overrides,
  };
}

function storyDetail(): StoryDetail {
  return {
    key: "repo-1:issue:17",
    id: "ghi-17",
    storyType: "issue",
    repoId: "repo-1",
    repoOwner: "octo",
    repoName: "repo",
    number: 17,
    title: "Story",
    state: "open",
    labels: [],
    assignees: [],
    author: "grace",
    htmlUrl: "https://github.test/octo/repo/issues/17",
    bodyMd: "Body",
    commentsCount: 0,
    ghCreatedAt: "2026-08-01T00:00:00Z",
    ghUpdatedAt: "2026-08-01T00:00:00Z",
    closedAt: null,
    prs: [],
    stage: { key: "backlog", label: "Backlog" },
    pipelineStages: [
      { key: "backlog", label: "Backlog" },
      { key: "planning", label: "Planning" },
      { key: "ready", label: "Ready" },
      { key: "building", label: "Building" },
      { key: "validating", label: "Validating" },
      { key: "review", label: "In review" },
      { key: "shipped", label: "Shipped" },
    ],
    allowLegacyProposalNumber: true,
    runs: [],
  };
}
