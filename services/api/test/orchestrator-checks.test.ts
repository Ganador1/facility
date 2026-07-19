import { describe, expect, it } from "vitest";
import {
  platformDeliveryFailure,
  renderRunContract,
  resolveCheckCmds,
  resolveProvisionCmd,
  runSafePermissions,
} from "../src/sandbox/orchestrator.js";

describe("platform delivery boundaries", () => {
  it("fails non-delivery agents that alter a repository", () => {
    expect(platformDeliveryFailure({ mode: "learning", gh: {} }, { changed: true })).toBe(
      "repository_changes_not_allowed",
    );
    expect(platformDeliveryFailure({ mode: "custom", gh: {} }, { changed: false })).toBeNull();
  });
});

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

describe("platform run repository setup", () => {
  it("uses the kickstart provision command when the profile has no override", () => {
    expect(resolveProvisionCmd({ setup: {} }, { provisionCmd: "pnpm install" })).toBe(
      "pnpm install",
    );
  });

  it("lets an explicit sandbox-profile provision command win", () => {
    expect(
      resolveProvisionCmd(
        { setup: { provision_cmd: "make bootstrap" } },
        { provisionCmd: "pnpm install" },
      ),
    ).toBe("make bootstrap");
  });

  it("renders repository setup and gates into platform contracts", () => {
    expect(
      renderRunContract("Provision: {{PROVISION_CMD}}\nChecks: {{CHECKS_INLINE}}", "pnpm install", [
        "pnpm test",
        "pnpm lint",
      ]),
    ).toBe("Provision: pnpm install\nChecks: pnpm test && pnpm lint");
  });
});

describe("runSafePermissions — run-key permission ceiling", () => {
  it("keeps an agent's run-safe scopes so its declared permissions take effect", () => {
    expect(runSafePermissions(["kb:write", "tasks:write", "hitl:write"])).toEqual([
      "hitl:write",
      "kb:write",
      "tasks:write",
    ]);
  });

  it("strips tenant-admin / destructive scopes no matter what the agent declares", () => {
    const clamped = runSafePermissions([
      "kb:write",
      "members:write",
      "roles:write",
      "keys:issue",
      "providers:write",
      "budgets:write",
      "org:write",
      "*",
    ]);
    expect(clamped).toEqual(["kb:write"]);
  });

  it("never grants hitl:decide to a run (a run can't approve its own gate)", () => {
    expect(runSafePermissions(["hitl:decide", "hitl:write"])).toEqual(["hitl:write"]);
  });

  it("falls back to the harness floor when nothing run-safe is declared", () => {
    expect(runSafePermissions([])).toEqual(["kb:read", "kb:write", "tasks:read", "tasks:write"]);
    expect(runSafePermissions(["members:write"])).toEqual([
      "kb:read",
      "kb:write",
      "tasks:read",
      "tasks:write",
    ]);
  });
});
