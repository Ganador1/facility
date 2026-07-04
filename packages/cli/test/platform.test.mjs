import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPlatformCommand } from "../src/platform.mjs";

function sink() {
  return {
    text: "",
    write(chunk) {
      this.text += chunk;
    },
  };
}

function config() {
  return {
    currentProfile: "default",
    profiles: { default: { url: "http://facility.test", key: "fak_test" } },
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("login verifies /v1/me and writes config with 0600 permissions", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "facility-platform-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "config.json");
  const stdout = sink();
  const calls = [];

  const exit = await runPlatformCommand("login", ["--url", "http://facility.test", "--key", "fak_secret"], {
    configPath: path,
    stdout,
    fetch: async (url, init) => {
      calls.push({ url: String(url), auth: init.headers.authorization });
      return json({ org: { slug: "tam" }, principal: { type: "key" } });
    },
  });

  assert.equal(exit, 0);
  assert.deepEqual(calls, [{ url: "http://facility.test/v1/me", auth: "Bearer fak_secret" }]);
  assert.equal((statSync(path).mode & 0o777).toString(8), "600");
  assert.ok(!stdout.text.includes("fak_secret"), "config secret must not be logged");
});

test("status --json emits parseable output", async () => {
  const stdout = sink();
  const exit = await runPlatformCommand("status", ["--json"], {
    config: config(),
    stdout,
    fetch: async (url) => {
      const path = new URL(url).pathname;
      if (path === "/v1/projects") return json([{ id: "proj_1", slug: "demo", name: "Demo", status: "active" }]);
      if (path === "/v1/inbox") return json([{ id: "prop_1", state: "open" }]);
      if (path === "/v1/issues") return json([]);
      if (path === "/v1/spend") return json([{ bucket: "today", cost_cents: 125 }]);
      if (path === "/v1/projects/proj_1/runs") return json([{ id: "run_1", status: "running" }]);
      return json({ error: { message: "missing fixture" } }, 404);
    },
  });

  assert.equal(exit, 0);
  const parsed = JSON.parse(stdout.text);
  assert.equal(parsed.liveRuns[0].id, "run_1");
  assert.equal(parsed.spend[0].cost_cents, 125);
});

test("runs and inbox render stub fetch fixtures", async () => {
  const runsOut = sink();
  const inboxOut = sink();
  const fetch = async (url) => {
    const path = new URL(url).pathname;
    if (path === "/v1/projects") return json([{ id: "proj_1", slug: "demo", name: "Demo", status: "active" }]);
    if (path === "/v1/projects/proj_1/runs") return json([{ id: "run_1", projectId: "proj_1", status: "running", mode: "builder" }]);
    if (path === "/v1/inbox") return json([{ id: "prop_1", state: "open", actionTypeId: "plan", projectId: "proj_1" }]);
    return json({ error: { message: "missing fixture" } }, 404);
  };

  assert.equal(await runPlatformCommand("runs", ["list"], { config: config(), stdout: runsOut, fetch }), 0);
  assert.equal(await runPlatformCommand("inbox", [], { config: config(), stdout: inboxOut, fetch }), 0);
  assert.ok(runsOut.text.includes("run_1"));
  assert.ok(inboxOut.text.includes("prop_1"));
});

test("steer and decide send exact request bodies", async () => {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ method: init.method, path: new URL(url).pathname, body: init.body && JSON.parse(init.body) });
    return json({ ok: true });
  };

  assert.equal(
    await runPlatformCommand("runs", ["steer", "run_1", "keep", "going"], {
      config: config(),
      stdout: sink(),
      fetch,
    }),
    0
  );
  assert.equal(
    await runPlatformCommand("inbox", ["decide", "prop_1", "approve", "--note", "looks good"], {
      config: config(),
      stdout: sink(),
      fetch,
    }),
    0
  );

  assert.deepEqual(calls, [
    { method: "POST", path: "/v1/runs/run_1/steer", body: { body: "keep going" } },
    { method: "POST", path: "/v1/proposals/prop_1/decide", body: { decision: "approve", note: "looks good" } },
  ]);
});

test("runs trigger sends agent identity for API resolution", async () => {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    const body = init.body && JSON.parse(init.body);
    calls.push({ method: init.method, path, body });
    if (path === "/v1/projects") return json([{ id: "proj_1", slug: "demo", name: "Demo" }]);
    if (path === "/v1/projects/proj_1/runs") return json({ id: "run_1" });
    return json({ error: { message: "missing fixture" } }, 404);
  };

  assert.equal(
    await runPlatformCommand("runs", ["trigger", "demo", "project-owner", "--input", '{"ok":true}'], {
      config: config(),
      stdout: sink(),
      fetch,
    }),
    0
  );

  assert.deepEqual(calls.at(-1), {
    method: "POST",
    path: "/v1/projects/proj_1/runs",
    body: {
      mode: "manual",
      engine: "codex",
      agent: "project-owner",
      trigger: { source: "cli", agentName: "project-owner", input: { ok: true } },
    },
  });
});

test("non-2xx maps to exit 1 with API error message", async () => {
  const stdout = sink();
  const exit = await runPlatformCommand("projects", ["list"], {
    config: config(),
    stdout,
    fetch: async () => json({ error: { message: "no permission" } }, 403),
  });

  assert.equal(exit, 1);
  assert.equal(stdout.text, "no permission\n");
});

test("401 maps to auth exit 2", async () => {
  const stdout = sink();
  const exit = await runPlatformCommand("status", [], {
    config: config(),
    stdout,
    fetch: async () => json({ error: { message: "bad key" } }, 401),
  });

  assert.equal(exit, 2);
  assert.equal(stdout.text, "bad key\n");
});
