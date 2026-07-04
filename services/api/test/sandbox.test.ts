import { hashKey, newId } from "@facility/core";
import { auditEvents, createDb, migrate, projects, runs, seed } from "@facility/db";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { AwsSandboxDriver } from "../src/sandbox/aws.js";
import { DockerSandboxDriver } from "../src/sandbox/docker.js";
import { reconcileSandboxes } from "../src/sandbox/orchestrator.js";
import type { AppConfig } from "../src/types.js";

const databaseUrl =
  process.env.DATABASE_URL ?? "postgres://facility:facility@localhost:5461/facility";
const masterKey = Buffer.alloc(32, 8).toString("base64");

async function canConnect() {
  const sqlClient = postgres(databaseUrl, { max: 1, connect_timeout: 2 });
  try {
    await sqlClient`select 1`;
    return true;
  } catch {
    return false;
  } finally {
    await sqlClient.end().catch(() => undefined);
  }
}

async function dockerReachable() {
  try {
    await new DockerSandboxDriver().status("definitely-missing");
    return true;
  } catch (error) {
    return error instanceof Error && !/connect|socket|permission/i.test(error.message);
  }
}

describe("sandbox api", async () => {
  const reachable = await canConnect();
  if (!reachable) {
    it.skip("Postgres is unreachable at DATABASE_URL; sandbox tests skipped", () => undefined);
    return;
  }

  const config: AppConfig = {
    databaseUrl,
    secretMasterKey: masterKey,
    port: 4401,
    publicUrl: "http://127.0.0.1:0",
    sandboxApiUrl: "http://127.0.0.1:0",
    sandboxGatewayUrl: "http://127.0.0.1:0",
    webUrl: "http://localhost:3000",
    facilityInsecureDev: true,
    logLevel: "silent",
  };
  const { db, client } = createDb(databaseUrl);
  const app = await buildApp(config);
  let cookie = "";
  let orgId = "";
  let projectId = "";

  beforeAll(async () => {
    await migrate(databaseUrl);
    await seed(databaseUrl);
    await app.ready();
    const login = await app.inject({
      method: "POST",
      url: "/auth/dev-login",
      payload: { email: `sandbox-${Date.now()}@example.com` },
    });
    cookie = login.cookies.map((item) => `${item.name}=${item.value}`).join("; ");
    orgId = login.json().orgId;
    await db.delete(auditEvents).where(eq(auditEvents.orgId, orgId));
    const project = (
      await db
        .insert(projects)
        .values({
          id: newId("proj"),
          orgId,
          name: "Sandbox Test Project",
          slug: `sandbox-${Date.now()}`,
          settings: {},
        })
        .returning()
    )[0];
    projectId = project?.id ?? "";
  });

  afterAll(async () => {
    await app.close();
    await client.end();
  });

  it("aws driver fails loudly as not_configured when env is missing", async () => {
    await expect(
      new AwsSandboxDriver().launch({
        runId: "run_test",
        image: "facility-runner:dev",
        env: {},
        cpu: 1,
        memoryMb: 512,
        timeoutMin: 1,
      }),
    ).rejects.toMatchObject({ code: "not_configured" });
  });

  it("rejects wrong runner tokens and terminal internal posts", async () => {
    const token = "frt_test";
    const run = await insertRunnerRun(token, "running");
    const wrong = await app.inject({
      method: "POST",
      url: `/internal/runs/${run.id}/events`,
      headers: { authorization: "Bearer wrong" },
      payload: [{ type: "assistant", data: { text: "no" } }],
    });
    expect(wrong.statusCode).toBe(401);
    await db
      .update(runs)
      .set({ status: "succeeded", endedAt: new Date() })
      .where(eq(runs.id, run.id));
    const terminal = await app.inject({
      method: "POST",
      url: `/internal/runs/${run.id}/events`,
      headers: { authorization: `Bearer ${token}` },
      payload: [{ type: "assistant", data: { text: "late" } }],
    });
    expect(terminal.statusCode).toBe(409);
  });

  it("delivers run events over the NOTIFY-backed SSE path", async () => {
    const token = "frt_stream";
    const run = await insertRunnerRun(token, "running");
    const address = await app.listen({ port: 0, host: "127.0.0.1" });
    const streamPromise = fetch(`${address}/v1/runs/${run.id}/stream?idleMs=1500`, {
      headers: { cookie },
    }).then((response) => response.text());
    await new Promise((resolve) => setTimeout(resolve, 100));
    const posted = await fetch(`${address}/internal/runs/${run.id}/events`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify([{ type: "assistant", data: { text: "notify delivered" } }]),
    });
    expect(posted.status).toBe(200);
    const body = await streamPromise;
    expect(body).toContain("event: run_event");
    expect(body).toContain("notify delivered");
  }, 10_000);

  it("launches, stops, and destroys a docker sleep container when Docker is reachable", async () => {
    if (!(await dockerReachable())) {
      console.warn("Docker socket is not reachable from this sandbox; skipping docker driver test");
      return;
    }
    const driver = new DockerSandboxDriver();
    const launched = await driver.launch({
      runId: `run_${Date.now()}`,
      image: "alpine:3.20",
      env: {},
      cpu: 0.5,
      memoryMb: 128,
      timeoutMin: 1,
      cmd: ["sleep", "30"],
    });
    expect(await driver.status(launched.ref)).toBe("running");
    await driver.stop(launched.ref);
    expect(await driver.status(launched.ref)).toBe("exited");
    await driver.destroy(launched.ref);
    expect(await driver.status(launched.ref)).toBe("lost");
  }, 60_000);

  it("reconciler destroys orphan docker containers after label and run-state double check", async () => {
    if (!(await dockerReachable())) {
      console.warn(
        "Docker socket is not reachable from this sandbox; skipping docker reconciler test",
      );
      return;
    }
    const driver = new DockerSandboxDriver();
    const runId = `run_orphan_${Date.now()}`;
    const launched = await driver.launch({
      runId,
      image: "alpine:3.20",
      env: {},
      cpu: 0.5,
      memoryMb: 128,
      timeoutMin: 1,
      cmd: ["sleep", "30"],
    });
    await reconcileSandboxes(config);
    expect(await driver.status(launched.ref)).toBe("lost");
  }, 60_000);

  async function insertRunnerRun(token: string, status: string) {
    const row = (
      await db
        .insert(runs)
        .values({
          id: newId("run"),
          orgId,
          projectId,
          mode: "builder",
          engine: "byo",
          status,
          trigger: {},
          sandbox: { runnerTokenHash: await hashKey(token) },
          createdBy: { type: "user", id: "test" },
        })
        .returning()
    )[0];
    if (!row) throw new Error("failed to insert runner run");
    return row;
  }
});
