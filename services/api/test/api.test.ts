import { newId } from "@facility/core";
import {
  actionTypes,
  agentDefs,
  auditEvents,
  createDb,
  llmRequests,
  migrate,
  poTasks,
  projects,
  proposalEvents,
  proposals,
  registryVersions,
  repos,
  seed,
} from "@facility/db";
import { eq, sql } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import type { AppConfig } from "../src/types.js";

const databaseUrl =
  process.env.DATABASE_URL ?? "postgres://facility:facility@localhost:5461/facility";
const masterKey = Buffer.alloc(32, 9).toString("base64");

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

describe("api", async () => {
  const reachable = await canConnect();
  if (!reachable) {
    it.skip("Postgres is unreachable at DATABASE_URL; API integration tests skipped", () =>
      undefined);
    return;
  }

  const config: AppConfig = {
    databaseUrl,
    secretMasterKey: masterKey,
    port: 4400,
    publicUrl: "http://localhost:4400",
    sandboxApiUrl: "http://localhost:4400",
    sandboxGatewayUrl: "http://localhost:4410",
    webUrl: "http://localhost:3000",
    facilityInsecureDev: true,
    logLevel: "silent",
  };
  const { db, client } = createDb(databaseUrl);
  const app = await buildApp(config);
  let cookie = "";
  let orgId = "";
  const ownerRole = "role_bundled_owner";
  const viewerRole = "role_bundled_viewer";
  let projectId = "";

  beforeAll(async () => {
    await migrate(databaseUrl);
    await seed(databaseUrl);
    await app.ready();
    const login = await app.inject({
      method: "POST",
      url: "/auth/dev-login",
      payload: { email: `api-${Date.now()}@example.com` },
    });
    expect(login.statusCode).toBe(200);
    cookie = login.cookies.map((item) => `${item.name}=${item.value}`).join("; ");
    orgId = login.json().orgId;
    await db.delete(auditEvents).where(eq(auditEvents.orgId, orgId));
    const setupProject = (
      await db
        .insert(projects)
        .values({
          id: newId("proj"),
          orgId,
          name: "API Setup Project",
          slug: `api-setup-${Date.now()}`,
          settings: {},
        })
        .returning()
    )[0];
    projectId = setupProject?.id ?? "";
  });

  afterAll(async () => {
    await app.close();
    await client.end();
  });

  it("dev-login resolves /v1/me", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/me", headers: { cookie } });
    expect(response.statusCode).toBe(200);
    expect(response.json().org.slug).toBe("the-agile-monkeys");
  });

  it("denies viewer key project mutation with needed permission", async () => {
    const issued = await app.inject({
      method: "POST",
      url: "/v1/keys",
      headers: { cookie },
      payload: { name: "viewer", roleId: viewerRole },
    });
    const secret = issued.json().secret;
    const denied = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: { authorization: `Bearer ${secret}` },
      payload: { name: "Denied", slug: `denied-${Date.now()}` },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.details.needed).toBe("projects:write");
  });

  it("issues, uses, and revokes an API key", async () => {
    const issued = await app.inject({
      method: "POST",
      url: "/v1/keys",
      headers: { cookie },
      payload: { name: "owner", roleId: ownerRole },
    });
    expect(issued.json().secret).toMatch(/^fak_/);
    const secret = issued.json().secret;
    const me = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { authorization: `Bearer ${secret}` },
    });
    expect(me.statusCode).toBe(200);
    await app.inject({
      method: "DELETE",
      url: `/v1/keys/${issued.json().id}`,
      headers: { cookie },
    });
    const revoked = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { authorization: `Bearer ${secret}` },
    });
    expect(revoked.statusCode).toBe(401);
  });

  it("performs project CRUD", async () => {
    const slug = `project-${Date.now()}`;
    const created = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: { cookie },
      payload: { name: "Project", slug },
    });
    expect(created.statusCode).toBe(200);
    projectId = created.json().id;
    const listed = await app.inject({ method: "GET", url: "/v1/projects", headers: { cookie } });
    expect(listed.json().some((row: { id: string }) => row.id === projectId)).toBe(true);
    const patched = await app.inject({
      method: "PATCH",
      url: `/v1/projects/${projectId}`,
      headers: { cookie },
      payload: { description: "updated" },
    });
    expect(patched.json().description).toBe("updated");
  });

  it("publishes registry drafts and keeps active content immutable", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/v1/registry/items",
      headers: { cookie },
      payload: { scope: "org", kind: "skill", name: `skill-${Date.now()}`, content: "v1" },
    });
    const version = created.json().versions[0];
    const published = await app.inject({
      method: "POST",
      url: `/v1/registry/versions/${version.id}/publish`,
      headers: { cookie },
    });
    expect(published.statusCode).toBe(200);
    const republish = await app.inject({
      method: "POST",
      url: `/v1/registry/versions/${version.id}/publish`,
      headers: { cookie },
    });
    expect(republish.statusCode).toBe(400);
    const row = (
      await db.select().from(registryVersions).where(eq(registryVersions.id, version.id)).limit(1)
    )[0];
    expect(row?.content).toBe("v1");
  });

  it("creates a run, pages events, and streams an SSE chunk", async () => {
    const run = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/runs`,
      headers: { cookie },
      payload: { mode: "builder", engine: "codex" },
    });
    expect(run.statusCode).toBe(200);
    const events = await app.inject({
      method: "GET",
      url: `/v1/runs/${run.json().id}/events`,
      headers: { cookie },
    });
    expect(events.json()[0].type).toBe("queued");
    const stream = await app.inject({
      method: "GET",
      url: `/v1/runs/${run.json().id}/stream?idleMs=50`,
      headers: { cookie },
    });
    expect(stream.body).toContain("event: heartbeat");
  });

  it("validates HITL payloads and appends decision ledger events", async () => {
    const type = (
      await db
        .insert(actionTypes)
        .values({
          id: newId("act"),
          orgId,
          name: `test_action_${Date.now()}`,
          payloadSchema: { type: "object", required: ["answer"] },
          resolver: { type: "permission", config: {} },
          executor: { type: "none", config: {} },
          defaultTtlHours: 1,
        })
        .returning()
    )[0];
    const bad = await app.inject({
      method: "POST",
      url: "/v1/proposals",
      headers: { cookie },
      payload: { actionTypeId: type?.id, payload: {}, contextMd: "ctx" },
    });
    expect(bad.statusCode).toBe(400);
    const proposal = await app.inject({
      method: "POST",
      url: "/v1/proposals",
      headers: { cookie },
      payload: { actionTypeId: type?.id, payload: { answer: true }, contextMd: "ctx" },
    });
    const decided = await app.inject({
      method: "POST",
      url: `/v1/proposals/${proposal.json().id}/decide`,
      headers: { cookie },
      payload: { decision: "approve", note: "ok" },
    });
    expect(decided.json().state).toBe("approved");
    const loaded = await app.inject({
      method: "GET",
      url: `/v1/proposals/${proposal.json().id}`,
      headers: { cookie },
    });
    expect(loaded.json().events.map((event: { seq: number }) => event.seq)).toEqual([1, 2]);
  });

  it("audit verify detects a manually corrupted row", async () => {
    await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: { cookie },
      payload: { name: "Audit Project", slug: `audit-${Date.now()}` },
    });
    const ok = await app.inject({ method: "GET", url: "/v1/audit/verify", headers: { cookie } });
    expect(ok.json().ok).toBe(true);
    const last = (
      await db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.orgId, orgId))
        .orderBy(sql`${auditEvents.seq} desc`)
        .limit(1)
    )[0];
    if (!last) throw new Error("expected audit row");
    await db
      .update(auditEvents)
      .set({ payload: { corrupted: true } })
      .where(eq(auditEvents.id, last.id));
    const broken = await app.inject({
      method: "GET",
      url: "/v1/audit/verify",
      headers: { cookie },
    });
    expect(broken.json().ok).toBe(false);
  });

  it("enforces KB parent DAG rule and writes bidirectional links", async () => {
    const space = await app.inject({
      method: "PUT",
      url: `/v1/projects/${projectId}/kb/space`,
      headers: { cookie },
      payload: {
        charterMd: "",
        activeMd: "",
        config: { artifact_types: [{ prefix: "H", name: "Hypothesis" }] },
      },
    });
    expect(space.statusCode).toBe(200);
    const fail = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/kb/entries`,
      headers: { cookie },
      payload: { type: "E", slug: "experiment", bodyMd: "body", links: [] },
    });
    expect(fail.statusCode).toBe(400);
    const parent = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/kb/entries`,
      headers: { cookie },
      payload: { type: "H", slug: "hypothesis", bodyMd: "body", links: [] },
    });
    const child = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/kb/entries`,
      headers: { cookie },
      payload: { type: "E", slug: "experiment", bodyMd: "body", links: [parent.json().id] },
    });
    expect(child.statusCode).toBe(200);
  });

  it("aggregates spend over llm request fixtures", async () => {
    await db.insert(llmRequests).values({
      id: newId("evt"),
      orgId,
      projectId,
      provider: "openai",
      model: "gpt-5.5",
      status: "ok",
      costCents: 123,
      latencyMs: 10,
    });
    const spend = await app.inject({
      method: "GET",
      url: "/v1/spend?groupBy=model",
      headers: { cookie },
    });
    expect(spend.statusCode).toBe(200);
    expect(
      spend
        .json()
        .some(
          (row: { bucket: string; cost_cents: number }) =>
            row.bucket === "gpt-5.5" && row.cost_cents >= 123,
        ),
    ).toBe(true);
  });

  it("startup assertion catches an undeclared protected route", async () => {
    const bad = await buildApp(config);
    bad.get("/v1/bad-test-route", async () => ({ ok: true }));
    await expect(bad.ready()).rejects.toThrow(/missing permission/i);
    await bad.close();
  });

  it("pins project-scoped keys to their project (404 elsewhere)", async () => {
    const other = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: { cookie },
      payload: { name: "Other", slug: `other-${Date.now()}` },
    });
    const issued = await app.inject({
      method: "POST",
      url: "/v1/keys",
      headers: { cookie },
      payload: { name: "pinned", roleId: ownerRole, projectId },
    });
    const secret = issued.json().secret;
    const own = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}`,
      headers: { authorization: `Bearer ${secret}` },
    });
    expect(own.statusCode).toBe(200);
    const cross = await app.inject({
      method: "GET",
      url: `/v1/projects/${other.json().id}`,
      headers: { authorization: `Bearer ${secret}` },
    });
    expect(cross.statusCode).toBe(404);
    // bare-id resources are pinned too
    const crossRun = await app.inject({
      method: "POST",
      url: `/v1/projects/${other.json().id}/runs`,
      headers: { cookie },
      payload: { mode: "builder", engine: "codex" },
    });
    const denied = await app.inject({
      method: "GET",
      url: `/v1/runs/${crossRun.json().id}`,
      headers: { authorization: `Bearer ${secret}` },
    });
    expect(denied.statusCode).toBe(404);
  });

  it("stores unique key prefixes so auth is an indexed lookup", async () => {
    const a = await app.inject({
      method: "POST",
      url: "/v1/keys",
      headers: { cookie },
      payload: { name: "prefix-a", roleId: viewerRole },
    });
    const b = await app.inject({
      method: "POST",
      url: "/v1/keys",
      headers: { cookie },
      payload: { name: "prefix-b", roleId: viewerRole },
    });
    expect(a.json().prefix).not.toBe(b.json().prefix);
    expect(a.json().prefix).toBe(String(a.json().secret).slice(0, 12));
  });

  it("rejects issuing a more privileged role than the caller has", async () => {
    const role = await app.inject({
      method: "POST",
      url: "/v1/roles",
      headers: { cookie },
      payload: { name: `issuer-${Date.now()}`, permissions: ["keys:issue"] },
    });
    expect(role.statusCode).toBe(200);
    const issued = await app.inject({
      method: "POST",
      url: "/v1/keys",
      headers: { cookie },
      payload: { name: "limited-issuer", roleId: role.json().id },
    });
    const denied = await app.inject({
      method: "POST",
      url: "/v1/keys",
      headers: { authorization: `Bearer ${issued.json().secret}` },
      payload: { name: "owner-escalation", roleId: ownerRole },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe("privilege_escalation");
  });

  it("blocks project-scoped keys from another project's proposal, task, and key", async () => {
    const other = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: { cookie },
      payload: { name: "Scoped Other", slug: `scoped-other-${Date.now()}` },
    });
    const otherProjectId = other.json().id;
    const ownKey = await app.inject({
      method: "POST",
      url: "/v1/keys",
      headers: { cookie },
      payload: { name: "own-project-owner", roleId: ownerRole, projectId },
    });
    const otherKey = await app.inject({
      method: "POST",
      url: "/v1/keys",
      headers: { cookie },
      payload: { name: "other-project-owner", roleId: ownerRole, projectId: otherProjectId },
    });
    const type = (
      await db
        .insert(actionTypes)
        .values({
          id: newId("act"),
          orgId,
          name: `scope_test_${Date.now()}`,
          payloadSchema: { type: "object", required: [] },
          resolver: { type: "permission", config: {} },
          executor: { type: "none", config: {} },
          defaultTtlHours: 1,
        })
        .returning()
    )[0];
    const proposal = (
      await db
        .insert(proposals)
        .values({
          id: newId("prop"),
          orgId,
          projectId: otherProjectId,
          actionTypeId: type?.id ?? "",
          payload: {},
          contextMd: "cross project",
          expiresAt: new Date(Date.now() + 3600_000),
        })
        .returning()
    )[0];
    const task = (
      await db
        .insert(poTasks)
        .values({
          id: newId("task"),
          orgId,
          projectId: otherProjectId,
          title: "Cross task",
          bodyMd: "body",
          wsjf: {},
        })
        .returning()
    )[0];
    const auth = { authorization: `Bearer ${ownKey.json().secret}` };
    const readProposal = await app.inject({
      method: "GET",
      url: `/v1/proposals/${proposal?.id}`,
      headers: auth,
    });
    expect(readProposal.statusCode).toBe(404);
    const mutateTask = await app.inject({
      method: "POST",
      url: `/v1/tasks/${task?.id}/transition`,
      headers: auth,
      payload: { status: "created" },
    });
    expect(mutateTask.statusCode).toBe(404);
    const revokeKey = await app.inject({
      method: "DELETE",
      url: `/v1/keys/${otherKey.json().id}`,
      headers: auth,
    });
    expect(revokeKey.statusCode).toBe(404);
  });

  it("returns 409 for an already-approved proposal without re-executing it", async () => {
    await db.insert(repos).values({
      id: newId("repo"),
      orgId,
      projectId,
      owner: `facility-test-${Date.now()}`,
      name: "repo",
      defaultBranch: "main",
    });
    const task = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/tasks`,
      headers: { cookie },
      payload: { title: "Create issue once", bodyMd: "body", wsjf: {} },
    });
    const proposed = await app.inject({
      method: "POST",
      url: `/v1/tasks/${task.json().id}/propose`,
      headers: { cookie },
    });
    const approved = await app.inject({
      method: "POST",
      url: `/v1/proposals/${proposed.json().id}/decide`,
      headers: { cookie },
      payload: { decision: "approve" },
    });
    expect(approved.statusCode).toBe(200);
    const repeated = await app.inject({
      method: "POST",
      url: `/v1/proposals/${proposed.json().id}/decide`,
      headers: { cookie },
      payload: { decision: "approve" },
    });
    expect(repeated.statusCode).toBe(409);
    const executed = await db
      .select()
      .from(proposalEvents)
      .where(
        sql`${proposalEvents.proposalId} = ${proposed.json().id} and ${proposalEvents.type} = 'executed'`,
      );
    expect(executed).toHaveLength(1);
  });

  it("ignores forbidden projectId and orgId fields on PATCH", async () => {
    const other = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: { cookie },
      payload: { name: "Patch Other", slug: `patch-other-${Date.now()}` },
    });
    const task = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/tasks`,
      headers: { cookie },
      payload: { title: "Patch guarded", bodyMd: "body", wsjf: {} },
    });
    const patched = await app.inject({
      method: "PATCH",
      url: `/v1/projects/${projectId}/tasks/${task.json().id}`,
      headers: { cookie },
      payload: { title: "Patch guarded updated", projectId: other.json().id, orgId: "org_bad" },
    });
    expect(patched.statusCode).toBe(200);
    const row = (await db.select().from(poTasks).where(eq(poTasks.id, task.json().id)).limit(1))[0];
    expect(row?.title).toBe("Patch guarded updated");
    expect(row?.projectId).toBe(projectId);
    expect(row?.orgId).toBe(orgId);
  });

  it("rejects triggering a run with an agent definition from another project", async () => {
    const projectA = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: { cookie },
      payload: { name: "Run A", slug: `run-a-${Date.now()}` },
    });
    const projectB = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: { cookie },
      payload: { name: "Run B", slug: `run-b-${Date.now()}` },
    });
    const foreignAgent = (
      await db.select().from(agentDefs).where(eq(agentDefs.projectId, projectB.json().id)).limit(1)
    )[0];
    expect(foreignAgent).toBeTruthy();
    const run = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectA.json().id}/runs`,
      headers: { cookie },
      payload: { mode: "builder", engine: "codex", agentDefId: foreignAgent?.id },
    });
    expect(run.statusCode).toBe(400);
    expect(run.json().error.code).toBe("agent_not_in_project");
  });

  it("refuses steering a finished run", async () => {
    const run = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/runs`,
      headers: { cookie },
      payload: { mode: "builder", engine: "codex" },
    });
    await app.inject({
      method: "POST",
      url: `/v1/runs/${run.json().id}/cancel`,
      headers: { cookie },
    });
    const steer = await app.inject({
      method: "POST",
      url: `/v1/runs/${run.json().id}/steer`,
      headers: { cookie },
      payload: { body: "hello?" },
    });
    expect(steer.statusCode).toBe(409);
  });
});
