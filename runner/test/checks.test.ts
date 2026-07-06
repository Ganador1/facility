import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { checkEvent, redactSecrets, runCheckCommand } from "../src/index.js";

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

describe("secret redaction of check output", () => {
  const key = "fvk_0123456789abcdef0123456789abcdef";

  it("scrubs every occurrence of an injected secret", () => {
    const out = redactSecrets(`auth ${key} then ${key} again`, [key]);
    expect(out).toBe("auth «redacted» then «redacted» again");
    expect(out).not.toContain(key);
  });

  it("scrubs a token embedded in an authenticated clone URL", () => {
    const token = "ghs_supersecrettoken1234567890";
    const out = redactSecrets(`https://x-access-token:${token}@github.com/o/r.git`, [token]);
    expect(out).not.toContain(token);
  });

  it("leaves short values alone so it cannot over-redact", () => {
    expect(redactSecrets("exit code 1, ok", ["1", "ok"])).toBe("exit code 1, ok");
  });

  it("passes text through untouched when there are no secrets", () => {
    expect(redactSecrets("nothing secret here", [])).toBe("nothing secret here");
  });
});
