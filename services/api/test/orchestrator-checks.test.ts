import { describe, expect, it } from "vitest";
import { resolveCheckCmds } from "../src/sandbox/orchestrator.js";

describe("resolveCheckCmds — acceptance-gate source of truth", () => {
  it("uses the project's configured checks when the sandbox profile has none", () => {
    expect(resolveCheckCmds({ setup: {} }, { check_cmds: ["pnpm test", "pnpm lint"] })).toEqual([
      "pnpm test",
      "pnpm lint",
    ]);
  });

  it("lets an explicit sandbox-profile override win over project checks", () => {
    expect(
      resolveCheckCmds({ setup: { check_cmds: ["make ci"] } }, { check_cmds: ["pnpm test"] }),
    ).toEqual(["make ci"]);
  });

  it("is empty when neither profile nor project configures checks", () => {
    expect(resolveCheckCmds({ setup: {} }, { check_cmds: [] })).toEqual([]);
    expect(resolveCheckCmds({ setup: {} }, undefined)).toEqual([]);
    expect(resolveCheckCmds({ setup: null }, null)).toEqual([]);
  });

  it("ignores non-string entries", () => {
    expect(resolveCheckCmds({ setup: {} }, { check_cmds: ["ok", 3, null, "fine"] })).toEqual([
      "ok",
      "fine",
    ]);
  });
});
