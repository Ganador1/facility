import { describe, expect, it } from "vitest";
import { progressCommentId, renderGithubRunProgress } from "../src/github/run-progress.js";

describe("GitHub run progress", () => {
  it("renders an in-place queued checklist with user context", () => {
    const body = renderGithubRunProgress({
      runId: "run_validation",
      mode: "architect",
      command: "/codex-architect",
      phase: "queued",
      issueNumber: 42,
      issueTitle: "Add subtraction\nwithout breaking addition",
      sender: "ada",
    });
    expect(body).toContain("### ⏳ Facility `/codex-architect`");
    expect(body).toContain("**Status:** In progress");
    expect(body).toContain("#42 — Add subtraction without breaking addition");
    expect(body).toContain("- [x] Accepted /codex-architect request");
    expect(body).toContain("- [ ] Published the plan and opened Human Gate 1");
    expect(body).toContain("Waiting for the agent to publish its task-specific checklist");
    expect(body).toContain("updated as the run crosses execution milestones");
  });

  it("replaces progress with the terminal result and human gate", () => {
    const body = renderGithubRunProgress({
      runId: "run_validation",
      mode: "architect",
      command: "/codex-architect",
      phase: "succeeded",
      issueNumber: 42,
      finalText: "1. Add the behavior.\n2. Run the tests.",
      proposalId: "prop_validation",
      agentProgress:
        "Working through the requested change.\n\n- [x] Inspect the code\n- [ ] Validate the plan",
    });
    expect(body).toContain("### ✅ Facility `/codex-architect`");
    expect(body).toContain("**Status:** Completed");
    expect(body).toContain("- [x] Published the plan and opened Human Gate 1");
    expect(body).toContain("1. Add the behavior.");
    expect(body).toContain("## Agent progress");
    expect(body).toContain("- [x] Inspect the code");
    expect(body).toContain("commenting `/codex-builder`");
    expect(body).toContain("commenting `/codex-architect <feedback>`");
    expect(body).toContain("`prop_validation`");
  });

  it("reads only a numeric stored progress comment id", () => {
    expect(progressCommentId({ progressComment: { id: 123 } })).toBe(123);
    expect(progressCommentId({ progressComment: { id: "123" } })).toBeNull();
    expect(progressCommentId(null)).toBeNull();
  });
});
