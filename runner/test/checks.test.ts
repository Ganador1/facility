import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  checkEvent,
  engineEnv,
  parseSelfReportedChecks,
  redactSecrets,
  runCheckCommand,
} from "../src/index.js";

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

describe("self-reported check provenance", () => {
  it("forces self_reported:true even when the agent line claims false", () => {
    const events = parseSelfReportedChecks(
      '{"name":"lint","status":"passed","self_reported":false}',
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.data.self_reported).toBe(true);
    expect(events[0]?.data.name).toBe("lint");
  });

  it("isolates a malformed line without dropping the valid ones", () => {
    const events = parseSelfReportedChecks(['{"name":"a"}', "not json", '{"name":"b"}'].join("\n"));
    expect(events.map((e) => e.data.name)).toEqual(["a", "b"]);
    expect(events.every((e) => e.data.self_reported === true)).toBe(true);
  });

  it("is empty for empty input", () => {
    expect(parseSelfReportedChecks("")).toEqual([]);
  });
});

describe("engine environment isolation", () => {
  const saved = { runner: process.env.RUNNER_TOKEN, auth: process.env.ANTHROPIC_AUTH_TOKEN };
  afterEach(() => {
    if (saved.runner === undefined) delete process.env.RUNNER_TOKEN;
    else process.env.RUNNER_TOKEN = saved.runner;
    if (saved.auth === undefined) delete process.env.ANTHROPIC_AUTH_TOKEN;
    else process.env.ANTHROPIC_AUTH_TOKEN = saved.auth;
  });

  it("never leaks the runner's internal-lifecycle token to the child engine/checks", () => {
    process.env.RUNNER_TOKEN = "rt_super_secret_runner_token";
    process.env.ANTHROPIC_AUTH_TOKEN = "should-be-stripped";
    const env = engineEnv();
    expect(env.RUNNER_TOKEN).toBeUndefined();
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(env.HOME).toBe("/work");
    // The runner's own process still holds the token for its api() calls.
    expect(process.env.RUNNER_TOKEN).toBe("rt_super_secret_runner_token");
  });
});
