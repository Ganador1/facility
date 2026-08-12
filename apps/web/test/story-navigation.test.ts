import { describe, expect, it } from "vitest";
import { STORY_STAGES, storyNavigation } from "@/lib/story-navigation";

describe("story navigation", () => {
  it("uses only the six durable stages as workspace destinations", () => {
    expect(STORY_STAGES.map(({ stage }) => stage)).toEqual([
      "backlog",
      "planning",
      "building",
      "validating",
      "review",
      "shipped",
    ]);
  });

  it("keeps the overview separate from stage selection", () => {
    expect(storyNavigation("project-1")).toEqual([
      { href: "/projects/project-1/stories", label: "Overview" },
      {
        href: "/projects/project-1/stories?stage=backlog",
        label: "Backlog",
        stage: "backlog",
      },
      {
        href: "/projects/project-1/stories?stage=planning",
        label: "Planning",
        stage: "planning",
      },
      {
        href: "/projects/project-1/stories?stage=building",
        label: "Building",
        stage: "building",
      },
      {
        href: "/projects/project-1/stories?stage=validating",
        label: "Validating",
        stage: "validating",
      },
      {
        href: "/projects/project-1/stories?stage=review",
        label: "Review",
        stage: "review",
      },
      {
        href: "/projects/project-1/stories?stage=shipped",
        label: "Shipped",
        stage: "shipped",
      },
    ]);
  });
});
