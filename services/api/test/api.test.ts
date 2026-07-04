import { newId } from "@facility/core";
import {
  actionTypes,
  agentDefs,
  auditEvents,
  createDb,
  llmRequests,
  migrate,
  orgMembers,
  orgs,
  poTasks,
  projects,
  proposalEvents,
  proposals,
  registryVersions,
  repos,
  roles,
  runs,
  seed,
  users,
} from "@facility/db";
import { eq, sql } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { ensureWorkosUser } from "../src/routes/auth.js";
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

  it("bootstraps the first WorkOS user as owner when no orgs exist", async () => {
    const rollback = new Error("rollback bootstrap test");
    await expect(
      db.transaction(async (tx) => {
        await tx.execute(sql`TRUNCATE TABLE orgs, users, roles CASCADE`);
        await tx.insert(roles).values({
          id: "role_bundled_owner",
          orgId: null,
          name: "owner",
          description: "Full organization control.",
          permissions: ["*"],
        });

        const session = await ensureWorkosUser(
          tx as unknown as Parameters<typeof ensureWorkosUser>[0],
          {
            workosUserId: "workos_first_admin",
            email: "first@theagilemonkeys.com",
            name: "First Admin",
          },
        );

        const membership = (
          await tx
            .select({ org: orgs, member: orgMembers, role: roles, user: users })
            .from(orgMembers)
            .innerJoin(orgs, eq(orgMembers.orgId, orgs.id))
            .innerJoin(roles, eq(orgMembers.roleId, roles.id))
            .innerJoin(users, eq(orgMembers.userId, users.id))
            .where(eq(orgMembers.userId, session.userId))
            .limit(1)
        )[0];
        expect(membership?.org.slug).toBe("theagilemonkeys");
        expect(membership?.role.name).toBe("owner");
        expect(membership?.user.workosUserId).toBe("workos_first_admin");
        throw rollback;
      }),
    ).rejects.toThrow(rollback.message);
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

  it("returns org-wide paginated runs with project metadata", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const projectA = (
      await db
        .insert(projects)
        .values({
          id: newId("proj"),
          orgId,
          name: "Runs Page A",
          slug: `runs-page-a-${suffix}`,
          settings: {},
        })
        .returning()
    )[0];
    const projectB = (
      await db
        .insert(projects)
        .values({
          id: newId("proj"),
          orgId,
          name: "Runs Page B",
          slug: `runs-page-b-${suffix}`,
          settings: {},
        })
        .returning()
    )[0];
    if (!projectA || !projectB) throw new Error("project setup failed");
    const oldRunId = newId("run");
    const newRunId = newId("run");
    const status = `runs_page_${suffix.replace(/[^a-z0-9]/g, "_")}`;
    await db.insert(runs).values([
      {
        id: oldRunId,
        orgId,
        projectId: projectA.id,
        mode: "builder",
        engine: "codex",
        status,
        queuedAt: new Date("2999-01-01T00:00:00Z"),
        createdBy: { type: "test", id: "api" },
      },
      {
        id: newRunId,
        orgId,
        projectId: projectB.id,
        mode: "builder",
        engine: "codex",
        status,
        queuedAt: new Date("2999-01-02T00:00:00Z"),
        createdBy: { type: "test", id: "api" },
      },
    ]);
    const page = await app.inject({
      method: "GET",
      url: `/v1/runs?status=${status}&limit=1&offset=0`,
      headers: { cookie },
    });
    expect(page.statusCode).toBe(200);
    expect(page.json()).toHaveLength(1);
    expect(page.json()[0]).toMatchObject({
      id: newRunId,
      project: { id: projectB.id, name: projectB.name, slug: projectB.slug },
    });
    const secondPage = await app.inject({
      method: "GET",
      url: `/v1/runs?status=${status}&limit=1&offset=1`,
      headers: { cookie },
    });
    expect(secondPage.statusCode).toBe(200);
    expect(secondPage.json()[0]?.id).toBe(oldRunId);
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

  it("groups spend by agent definition, not run id", async () => {
    const agent = (await db.select().from(agentDefs).where(eq(agentDefs.orgId, orgId)).limit(1))[0];
    expect(agent).toBeTruthy();
    if (!agent) throw new Error("agent fixture missing");
    const runA = newId("run");
    const runB = newId("run");
    await db.insert(runs).values([
      {
        id: runA,
        orgId,
        projectId: agent.projectId,
        agentDefId: agent.id,
        mode: "builder",
        engine: "codex",
        createdBy: { type: "test", id: "api" },
      },
      {
        id: runB,
        orgId,
        projectId: agent.projectId,
        agentDefId: agent.id,
        mode: "builder",
        engine: "codex",
        createdBy: { type: "test", id: "api" },
      },
    ]);
    await db.insert(llmRequests).values([
      {
        id: newId("evt"),
        orgId,
        projectId: agent.projectId,
        runId: runA,
        agentDefId: agent.id,
        provider: "openai",
        model: "gpt-5.5",
        status: "ok",
        costCents: 100,
        latencyMs: 10,
      },
      {
        id: newId("evt"),
        orgId,
        projectId: agent.projectId,
        runId: runB,
        agentDefId: agent.id,
        provider: "openai",
        model: "gpt-5.5",
        status: "ok",
        costCents: 125,
        latencyMs: 10,
      },
    ]);
    const spend = await app.inject({
      method: "GET",
      url: "/v1/spend?groupBy=agent",
      headers: { cookie },
    });
    expect(spend.statusCode).toBe(200);
    const row = spend
      .json()
      .find((item: { bucket: string; cost_cents: number }) => item.bucket === agent.id);
    expect(row?.cost_cents).toBeGreaterThanOrEqual(225);
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

  it("rejects assigning a member into a role more privileged than the caller", async () => {
    const mgrRole = await app.inject({
      method: "POST",
      url: "/v1/roles",
      headers: { cookie },
      payload: { name: `mgr-${Date.now()}`, permissions: ["members:write", "members:read"] },
    });
    const mgrKey = await app.inject({
      method: "POST",
      url: "/v1/keys",
      headers: { cookie },
      payload: { name: "limited-mgr", roleId: mgrRole.json().id },
    });
    const token = mgrKey.json().secret;
    const target = await app.inject({
      method: "POST",
      url: "/v1/members",
      headers: { cookie },
      payload: { email: `target-${Date.now()}@example.com`, roleId: viewerRole },
    });
    // The members-only manager cannot promote anyone (incl. itself) to owner(*).
    const denied = await app.inject({
      method: "PATCH",
      url: `/v1/members/${target.json().userId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { roleId: ownerRole },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe("privilege_escalation");
  });

  it("rejects creating a role with permissions the caller does not hold", async () => {
    const rolerRole = await app.inject({
      method: "POST",
      url: "/v1/roles",
      headers: { cookie },
      payload: { name: `roler-${Date.now()}`, permissions: ["roles:write", "roles:read"] },
    });
    const rolerKey = await app.inject({
      method: "POST",
      url: "/v1/keys",
      headers: { cookie },
      payload: { name: "limited-roler", roleId: rolerRole.json().id },
    });
    const token = rolerKey.json().secret;
    const wildcard = await app.inject({
      method: "POST",
      url: "/v1/roles",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: `escalated-${Date.now()}`, permissions: ["*"] },
    });
    expect(wildcard.statusCode).toBe(403);
    expect(wildcard.json().error.code).toBe("privilege_escalation");
    const bogus = await app.inject({
      method: "POST",
      url: "/v1/roles",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: `bogus-${Date.now()}`, permissions: ["not:aperm"] },
    });
    expect(bogus.statusCode).toBe(400);
    expect(bogus.json().error.code).toBe("invalid_permission");
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
