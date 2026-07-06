import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { checkEvent, runCheckCommand } from "../src/index.js";

describe("platform acceptance checks", () => {
  it("reports the exit code of a passing command", async () => {
    const { code } = await runCheckCommand("echo ok; exit 0", tmpdir(), 5);
    expect(code).toBe(0);
  });

  it("reports the non-zero exit code and captures stderr for a failing command", async () => {
    const { code, tail } = await runCheckCommand("echo boom 1>&2; exit 3", tmpdir(), 5);
    expect(code).toBe(3);
    expect(tail).toContain("boom");
  });

  it("surfaces a missing binary as a non-zero exit rather than throwing", async () => {
    const { code } = await runCheckCommand("this-binary-does-not-exist", tmpdir(), 5);
    expect(code).not.toBe(0);
  });

  it("builds a passed check event without carrying output", () => {
    expect(checkEvent("pnpm run typecheck", 0, "all good")).toEqual({
      self_reported: false,
      command: "pnpm run typecheck",
      status: "passed",
      exit_code: 0,
    });
  });

  it("builds a failed check event carrying the output tail", () => {
    expect(checkEvent("pnpm run test", 1, "1 failing")).toEqual({
      self_reported: false,
      command: "pnpm run test",
      status: "failed",
      exit_code: 1,
      output: "1 failing",
    });
  });

  it("caps the failure output at 2000 chars", () => {
    const event = checkEvent("x", 1, "z".repeat(5000));
    expect((event.output as string).length).toBe(2000);
  });
});
