import { generateApiKey, newId, seal, verifyKey } from "@facility/core";
import {
  actionTypes,
  agentDefs,
  apiKeys,
  auditEvents,
  budgets,
  kbEntries,
  kbLinks,
  kbSpaces,
  orgMembers,
  orgs,
  platformIssues,
  poTasks,
  projects,
  proposalEvents,
  proposals,
  providerCredentials,
  registryItems,
  registryVersions,
  repos,
  roles,
  runEvents,
  runs,
  sandboxProfiles,
  steerMessages,
  users,
  verifyAuditChain,
  virtualKeys,
  withOrg,
} from "@facility/db";
import { artifactIdFor, validate } from "@facility/harness";
import { and, asc, desc, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyReply } from "fastify";
import postgres from "postgres";
import { z } from "zod";
import { ApiError, notFound } from "../errors.js";
import { executeApprovedProposal } from "../executors.js";
import {
  ensureActive,
  ensureLinks,
  loadKbGraph,
  normalizeKbDraft,
  toHarnessEntry,
  toHarnessSpace,
  validateProjectKb,
} from "../harness.js";
import { cancelRun } from "../sandbox/orchestrator.js";
import { notifyRunEvent, readSandbox } from "../sandbox/state.js";
import type { AppConfig, Principal } from "../types.js";

const AnyObject = z.record(z.string(), z.unknown());
const Ok = z.object({ ok: z.boolean() });
const IdParams = z.object({
  projectId: z.string().optional(),
  runId: z.string().optional(),
  itemId: z.string().optional(),
  versionId: z.string().optional(),
  proposalId: z.string().optional(),
  entryId: z.string().optional(),
  taskId: z.string().optional(),
  issueId: z.string().optional(),
  keyId: z.string().optional(),
  userId: z.string().optional(),
  roleId: z.string().optional(),
});

function principal(request: { principal?: Principal }) {
  if (!request.principal) throw new ApiError(401, "unauthorized", "Authentication required");
  return request.principal;
}

function publicRow<T extends Record<string, unknown>>(row: T) {
  const { hash: _hash, sealedSecret: _sealedSecret, sealed_secret: _sealedSecret2, ...rest } = row;
  return rest;
}

export async function registerV1Routes(app: FastifyInstance, config: AppConfig) {
  const db = app.facilityDb;

  app.get(
    "/v1/me",
    {
      config: { permission: "org:read" },
      schema: {
        response: {
          200: z.object({ principal: AnyObject, org: AnyObject, permissions: z.array(z.string()) }),
        },
      },
    },
    async (request) => {
      const p = principal(request);
      const org = (await db.select().from(orgs).where(eq(orgs.id, p.orgId)).limit(1))[0];
      return { principal: p, org, permissions: p.permissions };
    },
  );

  app.get(
    "/v1/org",
    {
      config: { permission: "org:read" },
      schema: { response: { 200: AnyObject } },
    },
    async (request) => {
      const p = principal(request);
      return (await db.select().from(orgs).where(eq(orgs.id, p.orgId)).limit(1))[0] ?? null;
    },
  );

  app.patch(
    "/v1/org",
    {
      config: { permission: "org:write", auditAction: "org.updated" },
      schema: {
        body: z.object({ name: z.string().optional(), settings: AnyObject.optional() }),
        response: { 200: AnyObject },
      },
    },
    async (request) => {
      const p = principal(request);
      const body = request.body as { name?: string; settings?: Record<string, unknown> };
      return (
        await db
          .update(orgs)
          .set({ name: body.name, settings: body.settings, updatedAt: new Date() })
          .where(eq(orgs.id, p.orgId))
          .returning()
      )[0];
    },
  );

  app.get(
    "/v1/members",
    { config: { permission: "members:read" }, schema: { response: { 200: z.array(AnyObject) } } },
    async (request) => {
      const p = principal(request);
      return db
        .select({ member: orgMembers, user: users, role: roles })
        .from(orgMembers)
        .innerJoin(users, eq(orgMembers.userId, users.id))
        .innerJoin(roles, eq(orgMembers.roleId, roles.id))
        .where(eq(orgMembers.orgId, p.orgId));
    },
  );

  app.post(
    "/v1/members",
    {
      config: { permission: "members:write", auditAction: "member.added" },
      schema: {
        body: z.object({ email: z.string().email(), roleId: z.string() }),
        response: { 200: AnyObject },
      },
    },
    async (request) => {
      const p = principal(request);
      const body = request.body as { email: string; roleId: string };
      const existing = (
        await db.select().from(users).where(eq(users.email, body.email)).limit(1)
      )[0];
      const user =
        existing ??
        (
          await db
            .insert(users)
            .values({ id: newId("user"), email: body.email, status: "active" })
            .returning()
        )[0];
      if (!user) throw new ApiError(500, "insert_failed", "Could not create user");
      return (
        await db
          .insert(orgMembers)
          .values({ id: newId("user"), orgId: p.orgId, userId: user.id, roleId: body.roleId })
          .onConflictDoUpdate({
            target: [orgMembers.orgId, orgMembers.userId],
            set: { roleId: body.roleId, updatedAt: new Date() },
          })
          .returning()
      )[0];
    },
  );

  app.patch(
    "/v1/members/:userId",
    {
      config: { permission: "members:write", auditAction: "member.updated" },
      schema: {
        params: IdParams,
        body: z.object({ roleId: z.string() }),
        response: { 200: AnyObject },
      },
    },
    async (request) => {
      const p = principal(request);
      const { userId } = request.params as { userId: string };
      const { roleId } = request.body as { roleId: string };
      const row = (
        await db
          .update(orgMembers)
          .set({ roleId, updatedAt: new Date() })
          .where(and(eq(orgMembers.orgId, p.orgId), eq(orgMembers.userId, userId)))
          .returning()
      )[0];
      if (!row) throw notFound("Member not found");
      return row;
    },
  );

  app.delete(
    "/v1/members/:userId",
    {
      config: { permission: "members:write", auditAction: "member.removed" },
      schema: { params: IdParams, response: { 200: Ok } },
    },
    async (request) => {
      const p = principal(request);
      const { userId } = request.params as { userId: string };
      await db
        .delete(orgMembers)
        .where(and(eq(orgMembers.orgId, p.orgId), eq(orgMembers.userId, userId)));
      return { ok: true };
    },
  );

  app.get(
    "/v1/roles",
    { config: { permission: "roles:read" }, schema: { response: { 200: z.array(AnyObject) } } },
    async (request) => {
      const p = principal(request);
      return db
        .select()
        .from(roles)
        .where(or(isNull(roles.orgId), eq(roles.orgId, p.orgId)));
    },
  );

  app.post(
    "/v1/roles",
    {
      config: { permission: "roles:write", auditAction: "role.created" },
      schema: {
        body: z.object({
          name: z.string(),
          description: z.string().optional(),
          permissions: z.array(z.string()),
        }),
        response: { 200: AnyObject },
      },
    },
    async (request) => {
      const p = principal(request);
      const body = request.body as { name: string; description?: string; permissions: string[] };
      return (
        await db
          .insert(roles)
          .values({ id: newId("key"), orgId: p.orgId, ...body })
          .returning()
      )[0];
    },
  );

  app.patch(
    "/v1/roles/:roleId",
    {
      config: { permission: "roles:write", auditAction: "role.updated" },
      schema: {
        params: IdParams,
        body: z.object({
          description: z.string().optional(),
          permissions: z.array(z.string()).optional(),
        }),
        response: { 200: AnyObject },
      },
    },
    async (request) => {
      const p = principal(request);
      const { roleId } = request.params as { roleId: string };
      const role = (await db.select().from(roles).where(eq(roles.id, roleId)).limit(1))[0];
      if (!role) throw notFound("Role not found");
      if (!role.orgId) throw new ApiError(400, "bundled_immutable", "Bundled roles are immutable");
      return (
        await db
          .update(roles)
          .set({ ...(request.body as object), updatedAt: new Date() })
          .where(and(eq(roles.id, roleId), eq(roles.orgId, p.orgId)))
          .returning()
      )[0];
    },
  );

  app.delete(
    "/v1/roles/:roleId",
    {
      config: { permission: "roles:write", auditAction: "role.deleted" },
      schema: { params: IdParams, response: { 200: Ok } },
    },
    async (request) => {
      const p = principal(request);
      const { roleId } = request.params as { roleId: string };
      const role = (await db.select().from(roles).where(eq(roles.id, roleId)).limit(1))[0];
      if (role && !role.orgId)
        throw new ApiError(400, "bundled_immutable", "Bundled roles are immutable");
      await db.delete(roles).where(and(eq(roles.id, roleId), eq(roles.orgId, p.orgId)));
      return { ok: true };
    },
  );

  app.get(
    "/v1/keys",
    { config: { permission: "keys:issue" }, schema: { response: { 200: z.array(AnyObject) } } },
    async (request) => {
      const p = principal(request);
      return (await db.select().from(apiKeys).where(eq(apiKeys.orgId, p.orgId))).map(publicRow);
    },
  );

  app.post(
    "/v1/keys",
    {
      config: { permission: "keys:issue", auditAction: "key.issued" },
      schema: {
        body: z.object({ name: z.string(), roleId: z.string(), projectId: z.string().optional() }),
        response: { 200: AnyObject },
      },
    },
    async (request) => {
      const p = principal(request);
      const body = request.body as { name: string; roleId: string; projectId?: string };
      const key = await generateApiKey("fak");
      const row = (
        await db
          .insert(apiKeys)
          .values({
            id: key.id,
            orgId: p.orgId,
            name: body.name,
            prefix: key.lookup,
            last4: key.last4,
            hash: key.hash,
            scopeType: body.projectId ? "project" : "org",
            projectId: body.projectId,
            roleId: body.roleId,
            createdBy: p.id,
          })
          .returning()
      )[0];
      await request.audit(
        "key.issued",
        { type: "key", id: key.id },
        { name: body.name, last4: key.last4 },
      );
      return { ...publicRow(row ?? {}), secret: key.secret };
    },
  );

  app.delete(
    "/v1/keys/:keyId",
    {
      config: { permission: "keys:issue", auditAction: "key.revoked" },
      schema: { params: IdParams, response: { 200: Ok } },
    },
    async (request) => {
      const p = principal(request);
      const { keyId } = request.params as { keyId: string };
      await db
        .update(apiKeys)
        .set({ revokedAt: new Date() })
        .where(and(eq(apiKeys.orgId, p.orgId), eq(apiKeys.id, keyId)));
      await request.audit("key.revoked", { type: "key", id: keyId });
      return { ok: true };
    },
  );

  app.get(
    "/v1/projects",
    {
      config: { permission: "projects:read" },
      schema: {
        querystring: z.object({ status: z.string().optional() }),
        response: { 200: z.array(AnyObject) },
      },
    },
    async (request) => {
      const p = principal(request);
      const query = request.query as { status?: string };
      return withOrg(db, p.orgId).projects.list(query);
    },
  );

  app.post(
    "/v1/projects",
    {
      config: { permission: "projects:write", auditAction: "project.created" },
      schema: {
        body: z.object({
          name: z.string(),
          slug: z.string(),
          description: z.string().optional(),
          settings: AnyObject.optional(),
        }),
        response: { 200: AnyObject },
      },
    },
    async (request) => {
      const p = principal(request);
      const body = request.body as {
        name: string;
        slug: string;
        description?: string;
        settings?: Record<string, unknown>;
      };
      const project = (
        await db
          .insert(projects)
          .values({
            id: newId("proj"),
            orgId: p.orgId,
            name: body.name,
            slug: body.slug,
            description: body.description,
            settings: body.settings ?? { default_branch: "main", check_cmds: [] },
          })
          .returning()
      )[0];
      if (!project) throw new ApiError(500, "insert_failed", "Could not create project");
      await seedProjectHarnessAgents(p.orgId, project.id);
      return project;
    },
  );

  app.get(
    "/v1/projects/:projectId",
    {
      config: { permission: "projects:read" },
      schema: { params: IdParams, response: { 200: AnyObject } },
    },
    async (request) => {
      const p = principal(request);
      const { projectId } = request.params as { projectId: string };
      const row = await withOrg(db, p.orgId).projects.byId(projectId);
      if (!row) throw notFound("Project not found");
      return row;
    },
  );

  app.patch(
    "/v1/projects/:projectId",
    {
      config: { permission: "projects:write", auditAction: "project.updated" },
      schema: {
        params: IdParams,
        body: z.object({
          name: z.string().optional(),
          description: z.string().optional(),
          status: z.string().optional(),
          settings: AnyObject.optional(),
        }),
        response: { 200: AnyObject },
      },
    },
    async (request) => {
      const p = principal(request);
      const { projectId } = request.params as { projectId: string };
      return (
        await db
          .update(projects)
          .set({ ...(request.body as object), updatedAt: new Date() })
          .where(and(eq(projects.orgId, p.orgId), eq(projects.id, projectId)))
          .returning()
      )[0];
    },
  );

  app.delete(
    "/v1/projects/:projectId",
    {
      config: { permission: "projects:write", auditAction: "project.deleted" },
      schema: { params: IdParams, response: { 200: Ok } },
    },
    async (request) => {
      const p = principal(request);
      const { projectId } = request.params as { projectId: string };
      await db
        .update(projects)
        .set({ status: "archived", updatedAt: new Date() })
        .where(and(eq(projects.orgId, p.orgId), eq(projects.id, projectId)));
      return { ok: true };
    },
  );

  app.get(
    "/v1/projects/:projectId/repos",
    {
      config: { permission: "repos:read" },
      schema: { params: IdParams, response: { 200: z.array(AnyObject) } },
    },
    async (request) => {
      const p = principal(request);
      const { projectId } = request.params as { projectId: string };
      return withOrg(db, p.orgId).repos.listForProject(projectId);
    },
  );

  app.post(
    "/v1/projects/:projectId/repos",
    {
      config: { permission: "repos:write", auditAction: "repo.added" },
      schema: {
        params: IdParams,
        body: z.object({
          owner: z.string(),
          name: z.string(),
          defaultBranch: z.string().default("main"),
        }),
        response: { 200: AnyObject },
      },
    },
    async (request) => {
      const p = principal(request);
      const { projectId } = request.params as { projectId: string };
      const body = request.body as { owner: string; name: string; defaultBranch: string };
      return (
        await db
          .insert(repos)
          .values({ id: newId("repo"), orgId: p.orgId, projectId, ...body })
          .returning()
      )[0];
    },
  );

  app.delete(
    "/v1/projects/:projectId/repos/:repoId",
    {
      config: { permission: "repos:write", auditAction: "repo.removed" },
      schema: {
        params: z.object({ projectId: z.string(), repoId: z.string() }),
        response: { 200: Ok },
      },
    },
    async (request) => {
      const p = principal(request);
      const { projectId, repoId } = request.params as { projectId: string; repoId: string };
      await db
        .delete(repos)
        .where(and(eq(repos.orgId, p.orgId), eq(repos.projectId, projectId), eq(repos.id, repoId)));
      return { ok: true };
    },
  );

  app.get(
    "/v1/registry/items",
    {
      config: { permission: "registry:read" },
      schema: {
        querystring: z.object({
          kind: z.string().optional(),
          scope: z.string().optional(),
          projectId: z.string().optional(),
        }),
        response: { 200: z.array(AnyObject) },
      },
    },
    async (request) => {
      const p = principal(request);
      const q = request.query as { kind?: string; scope?: string; projectId?: string };
      const clauses = [eq(registryItems.orgId, p.orgId)];
      if (q.kind) clauses.push(eq(registryItems.kind, q.kind));
      if (q.scope) clauses.push(eq(registryItems.scope, q.scope));
      if (q.projectId) clauses.push(eq(registryItems.projectId, q.projectId));
      return db
        .select()
        .from(registryItems)
        .where(and(...clauses));
    },
  );

  app.get(
    "/v1/registry/items/:itemId",
    {
      config: { permission: "registry:read" },
      schema: { params: IdParams, response: { 200: AnyObject } },
    },
    async (request) => {
      const p = principal(request);
      const { itemId } = request.params as { itemId: string };
      const item = (
        await db
          .select()
          .from(registryItems)
          .where(and(eq(registryItems.orgId, p.orgId), eq(registryItems.id, itemId)))
          .limit(1)
      )[0];
      if (!item) throw notFound("Registry item not found");
      const versions = await db
        .select()
        .from(registryVersions)
        .where(and(eq(registryVersions.orgId, p.orgId), eq(registryVersions.itemId, itemId)))
        .orderBy(asc(registryVersions.version));
      return { ...item, versions };
    },
  );

  app.post(
    "/v1/registry/items",
    {
      config: { permission: "registry:write", auditAction: "registry.created" },
      schema: {
        body: z.object({
          scope: z.string(),
          projectId: z.string().optional(),
          kind: z.string(),
          name: z.string(),
          description: z.string().optional(),
          content: z.string(),
        }),
        response: { 200: AnyObject },
      },
    },
    async (request) => {
      const p = principal(request);
      const body = request.body as {
        scope: string;
        projectId?: string;
        kind: string;
        name: string;
        description?: string;
        content: string;
      };
      const item = (
        await db
          .insert(registryItems)
          .values({
            id: newId("item"),
            orgId: p.orgId,
            scope: body.scope,
            projectId: body.projectId,
            kind: body.kind,
            name: body.name,
            description: body.description,
            latestVersion: 0,
          })
          .returning()
      )[0];
      if (!item) throw new ApiError(500, "insert_failed", "Could not create item");
      const version = await createRegistryVersion(p.orgId, item.id, 1, body.content, "draft", p.id);
      return { ...item, versions: [version] };
    },
  );

  async function createRegistryVersion(
    orgId: string,
    itemId: string,
    version: number,
    content: string,
    status: string,
    createdBy: string,
  ) {
    const { createHash } = await import("node:crypto");
    return (
      await db
        .insert(registryVersions)
        .values({
          id: newId("ver"),
          orgId,
          itemId,
          version,
          content,
          contentHash: createHash("sha256").update(content).digest("hex"),
          status,
          createdBy,
        })
        .returning()
    )[0];
  }

  app.post(
    "/v1/registry/items/:itemId/versions",
    {
      config: { permission: "registry:write", auditAction: "registry.versioned" },
      schema: {
        params: IdParams,
        body: z.object({ content: z.string(), changelog: z.string().optional() }),
        response: { 200: AnyObject },
      },
    },
    async (request) => {
      const p = principal(request);
      const { itemId } = request.params as { itemId: string };
      const max =
        (
          await db
            .select()
            .from(registryVersions)
            .where(and(eq(registryVersions.orgId, p.orgId), eq(registryVersions.itemId, itemId)))
            .orderBy(desc(registryVersions.version))
            .limit(1)
        )[0]?.version ?? 0;
      return createRegistryVersion(
        p.orgId,
        itemId,
        max + 1,
        (request.body as { content: string }).content,
        "draft",
        p.id,
      );
    },
  );

  app.post(
    "/v1/registry/versions/:versionId/publish",
    {
      config: { permission: "registry:publish", auditAction: "registry.published" },
      schema: { params: IdParams, response: { 200: AnyObject } },
    },
    async (request) => {
      const p = principal(request);
      const { versionId } = request.params as { versionId: string };
      const version = (
        await db
          .update(registryVersions)
          .set({ status: "active", updatedAt: new Date() })
          .where(
            and(
              eq(registryVersions.orgId, p.orgId),
              eq(registryVersions.id, versionId),
              eq(registryVersions.status, "draft"),
            ),
          )
          .returning()
      )[0];
      if (!version)
        throw new ApiError(400, "invalid_state", "Only draft versions can be published");
      await db
        .update(registryItems)
        .set({ latestVersion: version.version })
        .where(and(eq(registryItems.orgId, p.orgId), eq(registryItems.id, version.itemId)));
      return version;
    },
  );

  app.post(
    "/v1/registry/versions/:versionId/deprecate",
    {
      config: { permission: "registry:publish", auditAction: "registry.deprecated" },
      schema: { params: IdParams, response: { 200: AnyObject } },
    },
    async (request) => {
      const p = principal(request);
      const { versionId } = request.params as { versionId: string };
      return (
        await db
          .update(registryVersions)
          .set({ status: "deprecated", updatedAt: new Date() })
          .where(and(eq(registryVersions.orgId, p.orgId), eq(registryVersions.id, versionId)))
          .returning()
      )[0];
    },
  );

  app.get(
    "/v1/projects/:projectId/runs",
    {
      config: { permission: "runs:read" },
      schema: {
        params: IdParams,
        querystring: z.object({ status: z.string().optional() }),
        response: { 200: z.array(AnyObject) },
      },
    },
    async (request) => {
      const p = principal(request);
      const { projectId } = request.params as { projectId: string };
      return withOrg(db, p.orgId).runs.listForProject(
        projectId,
        request.query as { status?: string },
      );
    },
  );

  app.post(
    "/v1/projects/:projectId/runs",
    {
      config: { permission: "runs:trigger", auditAction: "run.started" },
      schema: {
        params: IdParams,
        body: z.object({
          mode: z.string().default("builder"),
          engine: z.string().default("codex"),
          trigger: AnyObject.optional(),
          agentDefId: z.string().optional(),
        }),
        response: { 200: AnyObject },
      },
    },
    async (request) => {
      const p = principal(request);
      const { projectId } = request.params as { projectId: string };
      const body = request.body as {
        mode: string;
        engine: string;
        trigger?: Record<string, unknown>;
        agentDefId?: string;
      };
      const run = (
        await db
          .insert(runs)
          .values({
            id: newId("run"),
            orgId: p.orgId,
            projectId,
            agentDefId: body.agentDefId,
            mode: body.mode,
            engine: body.engine,
            trigger: body.trigger ?? {},
            createdBy: { type: p.type, id: p.id },
          })
          .returning()
      )[0];
      if (run) {
        await db.insert(runEvents).values({
          orgId: p.orgId,
          runId: run.id,
          seq: 1,
          type: "queued",
          data: { queue: "runs.dispatch" },
        });
        await app.enqueue("runs.dispatch", { runId: run.id, orgId: p.orgId });
      }
      return run;
    },
  );

  // Bare-id run access: org scope always; project-scoped keys are pinned to
  // their project (404 on anything else — no existence oracle).
  async function loadRun(p: ReturnType<typeof principal>, runId: string) {
    const row = await withOrg(db, p.orgId).runs.byId(runId);
    if (!row) throw notFound("Run not found");
    if (p.projectId && row.projectId !== p.projectId) throw notFound("Run not found");
    return row;
  }

  // Human-rate seq allocation (steer). The runner's internal event ingest owns
  // high-frequency assignment; collisions here surface as a retryable 500.
  async function nextRunEventSeq(dbx: typeof db, runId: string) {
    const rows = await dbx
      .select({ max: sql<number>`coalesce(max(seq), 0)` })
      .from(runEvents)
      .where(eq(runEvents.runId, runId));
    return Number(rows[0]?.max ?? 0) + 1;
  }

  app.get(
    "/v1/runs/:runId",
    {
      config: { permission: "runs:read" },
      schema: { params: IdParams, response: { 200: AnyObject } },
    },
    async (request) => {
      const p = principal(request);
      const { runId } = request.params as { runId: string };
      return loadRun(p, runId);
    },
  );

  app.post(
    "/v1/runs/:runId/cancel",
    {
      config: { permission: "runs:write", auditAction: "run.canceled" },
      schema: { params: IdParams, response: { 200: AnyObject } },
    },
    async (request) => {
      const p = principal(request);
      const { runId } = request.params as { runId: string };
      await loadRun(p, runId);
      const row = (
        await db
          .update(runs)
          .set({ status: "canceled", endedAt: new Date() })
          .where(and(eq(runs.orgId, p.orgId), eq(runs.id, runId)))
          .returning()
      )[0];
      if (!row) throw notFound("Run not found");
      await cancelRun(config, row);
      return row;
    },
  );

  app.get(
    "/v1/runs/:runId/events",
    {
      config: { permission: "runs:read" },
      schema: {
        params: IdParams,
        querystring: z.object({ afterSeq: z.coerce.number().optional() }),
        response: { 200: z.array(AnyObject) },
      },
    },
    async (request) => {
      const p = principal(request);
      const { runId } = request.params as { runId: string };
      const { afterSeq = 0 } = request.query as { afterSeq?: number };
      await loadRun(p, runId);
      return withOrg(db, p.orgId).runEvents.listAfter(runId, afterSeq);
    },
  );

  app.get(
    "/v1/runs/:runId/stream",
    {
      config: { permission: "runs:read" },
      schema: {
        params: IdParams,
        querystring: z.object({
          afterSeq: z.coerce.number().optional(),
          idleMs: z.coerce.number().int().min(50).max(25_000).optional(),
        }),
      },
    },
    async (request, reply) => {
      const p = principal(request);
      const { runId } = request.params as { runId: string };
      const { afterSeq = 0, idleMs = 25_000 } = request.query as {
        afterSeq?: number;
        idleMs?: number;
      };
      await loadRun(p, runId);
      await streamRunEvents(config, reply, runId, afterSeq, idleMs, async (seq) =>
        withOrg(db, p.orgId).runEvents.listAfter(runId, seq, 10),
      );
    },
  );

  app.post(
    "/v1/runs/:runId/steer",
    {
      config: { permission: "runs:steer", auditAction: "run.steered" },
      schema: {
        params: IdParams,
        body: z.object({ body: z.string().min(1) }),
        response: { 200: AnyObject },
      },
    },
    async (request) => {
      const p = principal(request);
      const { runId } = request.params as { runId: string };
      const run = await loadRun(p, runId);
      if (["succeeded", "failed", "canceled"].includes(run.status)) {
        throw new ApiError(409, "run_terminal", "Cannot steer a finished run");
      }
      const message = (
        await db
          .insert(steerMessages)
          .values({
            id: newId("evt"),
            orgId: p.orgId,
            runId,
            authorUserId: p.userId,
            body: (request.body as { body: string }).body,
          })
          .returning()
      )[0];
      const steerEvent = (
        await db
          .insert(runEvents)
          .values({
            orgId: p.orgId,
            runId,
            seq: await nextRunEventSeq(db, runId),
            type: "steer",
            data: { text: (request.body as { body: string }).body, author: p.id },
          })
          .returning()
      )[0];
      if (steerEvent) await notifyRunEvent(db, runId, steerEvent);
      return message;
    },
  );

  app.get(
    "/v1/providers",
    { config: { permission: "providers:read" }, schema: { response: { 200: z.array(AnyObject) } } },
    async (request) => {
      const p = principal(request);
      return (
        await db.select().from(providerCredentials).where(eq(providerCredentials.orgId, p.orgId))
      ).map((row) => ({
        id: row.id,
        provider: row.provider,
        name: row.name,
        baseUrl: row.baseUrl,
        createdAt: row.createdAt,
      }));
    },
  );

  app.post(
    "/v1/providers",
    {
      config: { permission: "providers:write", auditAction: "provider.created" },
      schema: {
        body: z.object({
          provider: z.string(),
          name: z.string(),
          baseUrl: z.string().optional(),
          secret: z.string(),
        }),
        response: { 200: AnyObject },
      },
    },
    async (request) => {
      const p = principal(request);
      const body = request.body as {
        provider: string;
        name: string;
        baseUrl?: string;
        secret: string;
      };
      const sealedSecret = await seal(body.secret, config.secretMasterKey);
      const row = (
        await db
          .insert(providerCredentials)
          .values({
            id: newId("key"),
            orgId: p.orgId,
            provider: body.provider,
            name: body.name,
            baseUrl: body.baseUrl,
            sealedSecret,
            createdBy: p.id,
          })
          .returning()
      )[0];
      return row
        ? {
            id: row.id,
            provider: row.provider,
            name: row.name,
            baseUrl: row.baseUrl,
            createdAt: row.createdAt,
          }
        : null;
    },
  );

  app.delete(
    "/v1/providers/:providerId",
    {
      config: { permission: "providers:write", auditAction: "provider.deleted" },
      schema: { params: z.object({ providerId: z.string() }), response: { 200: Ok } },
    },
    async (request) => {
      const p = principal(request);
      await db
        .delete(providerCredentials)
        .where(
          and(
            eq(providerCredentials.orgId, p.orgId),
            eq(providerCredentials.id, (request.params as { providerId: string }).providerId),
          ),
        );
      return { ok: true };
    },
  );

  app.post(
    "/v1/projects/:projectId/virtual-keys",
    {
      config: { permission: "keys:issue", auditAction: "key.issued" },
      schema: {
        params: IdParams,
        body: z.object({
          name: z.string(),
          allowedModels: z.array(z.string()).optional(),
          expiresAt: z.string().optional(),
        }),
        response: { 200: AnyObject },
      },
    },
    async (request) => {
      const p = principal(request);
      const { projectId } = request.params as { projectId: string };
      const body = request.body as { name: string; allowedModels?: string[]; expiresAt?: string };
      const key = await generateApiKey("fvk");
      const row = (
        await db
          .insert(virtualKeys)
          .values({
            id: key.id,
            orgId: p.orgId,
            projectId,
            name: body.name,
            prefix: key.lookup,
            last4: key.last4,
            hash: key.hash,
            allowedModels: body.allowedModels,
            expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
          })
          .returning()
      )[0];
      return { ...publicRow(row ?? {}), secret: key.secret };
    },
  );

  app.get(
    "/v1/projects/:projectId/virtual-keys",
    {
      config: { permission: "keys:issue" },
      schema: { params: IdParams, response: { 200: z.array(AnyObject) } },
    },
    async (request) => {
      const p = principal(request);
      const { projectId } = request.params as { projectId: string };
      return (
        await db
          .select()
          .from(virtualKeys)
          .where(and(eq(virtualKeys.orgId, p.orgId), eq(virtualKeys.projectId, projectId)))
      ).map(publicRow);
    },
  );

  app.delete(
    "/v1/projects/:projectId/virtual-keys/:keyId",
    {
      config: { permission: "keys:issue", auditAction: "key.revoked" },
      schema: {
        params: z.object({ projectId: z.string(), keyId: z.string() }),
        response: { 200: Ok },
      },
    },
    async (request) => {
      const p = principal(request);
      const { keyId } = request.params as { keyId: string };
      await db
        .update(virtualKeys)
        .set({ revokedAt: new Date() })
        .where(and(eq(virtualKeys.orgId, p.orgId), eq(virtualKeys.id, keyId)));
      return { ok: true };
    },
  );

  app.get(
    "/v1/budgets",
    { config: { permission: "budgets:read" }, schema: { response: { 200: z.array(AnyObject) } } },
    async (request) =>
      db
        .select()
        .from(budgets)
        .where(eq(budgets.orgId, principal(request).orgId)),
  );
  app.post(
    "/v1/budgets",
    {
      config: { permission: "budgets:write", auditAction: "budget.breached" },
      schema: {
        body: z.object({
          scope: z.string(),
          projectId: z.string().optional(),
          agentDefId: z.string().optional(),
          period: z.string(),
          limitCents: z.number().int(),
          mode: z.string(),
          enabled: z.boolean().default(true),
        }),
        response: { 200: AnyObject },
      },
    },
    async (request) => {
      const body = request.body as {
        scope: string;
        projectId?: string;
        agentDefId?: string;
        period: string;
        limitCents: number;
        mode: string;
        enabled: boolean;
      };
      return (
        await db
          .insert(budgets)
          .values({ id: newId("bud"), orgId: principal(request).orgId, ...body })
          .returning()
      )[0];
    },
  );
  app.patch(
    "/v1/budgets/:budgetId",
    {
      config: { permission: "budgets:write", auditAction: "budget.breached" },
      schema: {
        params: z.object({ budgetId: z.string() }),
        body: AnyObject,
        response: { 200: AnyObject },
      },
    },
    async (request) =>
      (
        await db
          .update(budgets)
          .set({ ...(request.body as object), updatedAt: new Date() })
          .where(
            and(
              eq(budgets.orgId, principal(request).orgId),
              eq(budgets.id, (request.params as { budgetId: string }).budgetId),
            ),
          )
          .returning()
      )[0],
  );
  app.delete(
    "/v1/budgets/:budgetId",
    {
      config: { permission: "budgets:write", auditAction: "budget.breached" },
      schema: { params: z.object({ budgetId: z.string() }), response: { 200: Ok } },
    },
    async (request) => {
      await db
        .delete(budgets)
        .where(
          and(
            eq(budgets.orgId, principal(request).orgId),
            eq(budgets.id, (request.params as { budgetId: string }).budgetId),
          ),
        );
      return { ok: true };
    },
  );

  app.get(
    "/v1/spend",
    {
      config: { permission: "spend:read" },
      schema: {
        querystring: z.object({
          projectId: z.string().optional(),
          from: z.string().optional(),
          to: z.string().optional(),
          groupBy: z.enum(["model", "agent", "day"]).optional(),
        }),
        response: { 200: z.array(AnyObject) },
      },
    },
    async (request) => {
      const p = principal(request);
      const q = request.query as {
        projectId?: string;
        from?: string;
        to?: string;
        groupBy?: "model" | "agent" | "day";
      };
      const from = (q.from ? new Date(q.from) : new Date("1970-01-01T00:00:00Z")).toISOString();
      const to = (q.to ? new Date(q.to) : new Date("2999-01-01T00:00:00Z")).toISOString();
      const groupExpr =
        q.groupBy === "day"
          ? sql`date_trunc('day', created_at)::text`
          : q.groupBy === "agent"
            ? sql`coalesce(run_id, 'none')`
            : sql`model`;
      const result = q.projectId
        ? await db.execute(
            sql`SELECT ${groupExpr} AS bucket, coalesce(sum(cost_cents), 0)::int AS cost_cents FROM llm_requests WHERE org_id = ${p.orgId} AND project_id = ${q.projectId} AND created_at >= ${from}::timestamptz AND created_at <= ${to}::timestamptz GROUP BY 1 ORDER BY 1`,
          )
        : await db.execute(
            sql`SELECT ${groupExpr} AS bucket, coalesce(sum(cost_cents), 0)::int AS cost_cents FROM llm_requests WHERE org_id = ${p.orgId} AND created_at >= ${from}::timestamptz AND created_at <= ${to}::timestamptz GROUP BY 1 ORDER BY 1`,
          );
      return Array.from(result as Iterable<Record<string, unknown>>);
    },
  );

  app.get(
    "/v1/inbox",
    {
      config: { permission: "hitl:read" },
      schema: {
        querystring: z.object({ state: z.string().optional() }),
        response: { 200: z.array(AnyObject) },
      },
    },
    async (request) => {
      const p = principal(request);
      const state = (request.query as { state?: string }).state;
      return db
        .select()
        .from(proposals)
        .where(
          state
            ? and(eq(proposals.orgId, p.orgId), eq(proposals.state, state))
            : eq(proposals.orgId, p.orgId),
        );
    },
  );

  app.get(
    "/v1/proposals/:proposalId",
    {
      config: { permission: "hitl:read" },
      schema: { params: IdParams, response: { 200: AnyObject } },
    },
    async (request) => {
      const p = principal(request);
      const { proposalId } = request.params as { proposalId: string };
      const proposal = (
        await db
          .select()
          .from(proposals)
          .where(and(eq(proposals.orgId, p.orgId), eq(proposals.id, proposalId)))
          .limit(1)
      )[0];
      const events = await db
        .select()
        .from(proposalEvents)
        .where(and(eq(proposalEvents.orgId, p.orgId), eq(proposalEvents.proposalId, proposalId)))
        .orderBy(asc(proposalEvents.seq));
      return { ...proposal, events };
    },
  );

  app.post(
    "/v1/proposals",
    {
      config: { permission: "hitl:write", auditAction: "hitl.proposed" },
      schema: {
        body: z.object({
          projectId: z.string().optional(),
          runId: z.string().optional(),
          actionTypeId: z.string(),
          payload: AnyObject,
          contextMd: z.string(),
          expiresAt: z.string().optional(),
        }),
        response: { 200: AnyObject },
      },
    },
    async (request) => {
      const p = principal(request);
      const body = request.body as {
        projectId?: string;
        runId?: string;
        actionTypeId: string;
        payload: Record<string, unknown>;
        contextMd: string;
        expiresAt?: string;
      };
      const actionType = (
        await db
          .select()
          .from(actionTypes)
          .where(and(eq(actionTypes.orgId, p.orgId), eq(actionTypes.id, body.actionTypeId)))
          .limit(1)
      )[0];
      if (!actionType) throw notFound("Action type not found");
      const required = Array.isArray((actionType.payloadSchema as { required?: unknown }).required)
        ? (actionType.payloadSchema as { required: string[] }).required
        : [];
      for (const key of required)
        if (!(key in body.payload))
          throw new ApiError(400, "schema_validation_failed", `Missing payload field: ${key}`);
      const proposal = (
        await db
          .insert(proposals)
          .values({
            id: newId("prop"),
            orgId: p.orgId,
            projectId: body.projectId,
            runId: body.runId,
            actionTypeId: body.actionTypeId,
            payload: body.payload,
            contextMd: body.contextMd,
            expiresAt: body.expiresAt
              ? new Date(body.expiresAt)
              : new Date(Date.now() + actionType.defaultTtlHours * 3600_000),
          })
          .returning()
      )[0];
      if (proposal)
        await db.insert(proposalEvents).values({
          orgId: p.orgId,
          proposalId: proposal.id,
          seq: 1,
          type: "open",
          actor: { type: p.type, id: p.id },
          data: {},
        });
      return proposal;
    },
  );

  app.post(
    "/v1/proposals/:proposalId/decide",
    {
      config: { permission: "hitl:decide", auditAction: "hitl.decided" },
      schema: {
        params: IdParams,
        body: z.object({ decision: z.enum(["approve", "reject"]), note: z.string().optional() }),
        response: { 200: AnyObject },
      },
    },
    async (request) => {
      const p = principal(request);
      const { proposalId } = request.params as { proposalId: string };
      const body = request.body as { decision: "approve" | "reject"; note?: string };
      const state = body.decision === "approve" ? "approved" : "rejected";
      const row = (
        await db
          .update(proposals)
          .set({ state, decidedBy: p.id, decidedAt: new Date() })
          .where(and(eq(proposals.orgId, p.orgId), eq(proposals.id, proposalId)))
          .returning()
      )[0];
      const current = await db
        .select()
        .from(proposalEvents)
        .where(and(eq(proposalEvents.orgId, p.orgId), eq(proposalEvents.proposalId, proposalId)))
        .orderBy(desc(proposalEvents.seq))
        .limit(1);
      await db.insert(proposalEvents).values({
        orgId: p.orgId,
        proposalId,
        seq: (current[0]?.seq ?? 0) + 1,
        type: state,
        actor: { type: p.type, id: p.id },
        data: { note: body.note },
      });
      if (row && state === "approved") {
        await executeApprovedProposal(db, row, { type: p.type, id: p.id });
      }
      return row;
    },
  );

  app.get(
    "/v1/issues",
    {
      config: { permission: "issues:read" },
      schema: {
        querystring: z.object({ state: z.string().optional(), kind: z.string().optional() }),
        response: { 200: z.array(AnyObject) },
      },
    },
    async (request) => {
      const p = principal(request);
      const q = request.query as { state?: string; kind?: string };
      const clauses = [eq(platformIssues.orgId, p.orgId)];
      if (q.state) clauses.push(eq(platformIssues.state, q.state));
      if (q.kind) clauses.push(eq(platformIssues.kind, q.kind));
      return db
        .select()
        .from(platformIssues)
        .where(and(...clauses));
    },
  );

  for (const action of ["ack", "resolve"] as const) {
    app.post(
      `/v1/issues/:issueId/${action}`,
      {
        config: {
          permission: "issues:write",
          auditAction: action === "ack" ? "issue.acked" : "issue.resolved",
        },
        schema: { params: IdParams, response: { 200: AnyObject } },
      },
      async (request) => {
        const p = principal(request);
        const { issueId } = request.params as { issueId: string };
        return (
          await db
            .update(platformIssues)
            .set({ state: action === "ack" ? "acked" : "resolved", updatedAt: new Date() })
            .where(and(eq(platformIssues.orgId, p.orgId), eq(platformIssues.id, issueId)))
            .returning()
        )[0];
      },
    );
  }

  app.get(
    "/v1/audit",
    {
      config: { permission: "audit:read" },
      schema: {
        querystring: z.object({
          from: z.coerce.number().optional(),
          to: z.coerce.number().optional(),
          actor: z.string().optional(),
          action: z.string().optional(),
        }),
        response: { 200: z.array(AnyObject) },
      },
    },
    async (request) => {
      const p = principal(request);
      const q = request.query as { from?: number; to?: number; action?: string };
      const clauses = [eq(auditEvents.orgId, p.orgId)];
      if (q.from) clauses.push(gte(auditEvents.seq, q.from));
      if (q.to) clauses.push(lte(auditEvents.seq, q.to));
      if (q.action) clauses.push(eq(auditEvents.action, q.action));
      return db
        .select()
        .from(auditEvents)
        .where(and(...clauses))
        .orderBy(asc(auditEvents.seq))
        .limit(200);
    },
  );

  app.get(
    "/v1/audit/verify",
    {
      config: { permission: "audit:read" },
      schema: {
        querystring: z.object({ from: z.string().optional(), to: z.string().optional() }),
        response: { 200: z.object({ ok: z.boolean(), firstBreakSeq: z.number().nullable() }) },
      },
    },
    async (request) => verifyAuditChain(db, principal(request).orgId),
  );

  app.get(
    "/v1/projects/:projectId/kb/space",
    {
      config: { permission: "kb:read" },
      schema: { params: IdParams, response: { 200: AnyObject } },
    },
    async (request) => {
      const p = principal(request);
      const { projectId } = request.params as { projectId: string };
      return (
        (
          await db
            .select()
            .from(kbSpaces)
            .where(and(eq(kbSpaces.orgId, p.orgId), eq(kbSpaces.projectId, projectId)))
            .limit(1)
        )[0] ?? null
      );
    },
  );

  app.put(
    "/v1/projects/:projectId/kb/space",
    {
      config: { permission: "kb:write", auditAction: "kb.updated" },
      schema: {
        params: IdParams,
        body: z.object({
          charterMd: z.string().default(""),
          activeMd: z.string().default(""),
          config: AnyObject.default({}),
        }),
        response: { 200: AnyObject },
      },
    },
    async (request) => {
      const p = principal(request);
      const { projectId } = request.params as { projectId: string };
      const body = request.body as {
        charterMd: string;
        activeMd: string;
        config: Record<string, unknown>;
      };
      return (
        await db
          .insert(kbSpaces)
          .values({ id: newId("kb"), orgId: p.orgId, projectId, ...body })
          .onConflictDoUpdate({
            target: kbSpaces.projectId,
            set: { ...body, updatedAt: new Date() },
          })
          .returning()
      )[0];
    },
  );

  app.get(
    "/v1/projects/:projectId/kb/entries",
    {
      config: { permission: "kb:read" },
      schema: {
        params: IdParams,
        querystring: z.object({ type: z.string().optional() }),
        response: { 200: z.array(AnyObject) },
      },
    },
    async (request) => {
      const p = principal(request);
      const space = await spaceFor(p.orgId, (request.params as { projectId: string }).projectId);
      if (!space) return [];
      const type = (request.query as { type?: string }).type;
      return db
        .select()
        .from(kbEntries)
        .where(
          type
            ? and(
                eq(kbEntries.orgId, p.orgId),
                eq(kbEntries.spaceId, space.id),
                eq(kbEntries.type, type),
              )
            : and(eq(kbEntries.orgId, p.orgId), eq(kbEntries.spaceId, space.id)),
        );
    },
  );

  app.get(
    "/v1/kb/entries/:entryId",
    {
      config: { permission: "kb:read" },
      schema: { params: IdParams, response: { 200: AnyObject } },
    },
    async (request) => {
      const p = principal(request);
      return (
        (
          await db
            .select()
            .from(kbEntries)
            .where(
              and(
                eq(kbEntries.orgId, p.orgId),
                eq(kbEntries.id, (request.params as { entryId: string }).entryId),
              ),
            )
            .limit(1)
        )[0] ?? null
      );
    },
  );

  app.post(
    "/v1/projects/:projectId/kb/entries",
    {
      config: { permission: "kb:write", auditAction: "kb.updated" },
      schema: {
        params: IdParams,
        querystring: z.object({ dry: z.coerce.number().optional() }),
        body: z.object({
          type: z.string(),
          slug: z.string(),
          frontmatter: AnyObject.default({}),
          bodyMd: z.string(),
          status: z.string().optional(),
          links: z.array(z.string()).default([]),
        }),
        response: { 200: AnyObject },
      },
    },
    async (request) => {
      const p = principal(request);
      const { projectId } = request.params as { projectId: string };
      const body = request.body as {
        type: string;
        slug: string;
        frontmatter: Record<string, unknown>;
        bodyMd: string;
        status?: string;
        links: string[];
      };
      const dry = (request.query as { dry?: number }).dry === 1;
      const space = await spaceFor(p.orgId, projectId);
      if (!space) throw notFound("KB space not found");
      const graph = await loadKbGraph(db, p.orgId, projectId);
      if (!graph) throw notFound("KB space not found");
      const max =
        (
          await db
            .select()
            .from(kbEntries)
            .where(
              and(
                eq(kbEntries.orgId, p.orgId),
                eq(kbEntries.spaceId, space.id),
                eq(kbEntries.type, body.type),
              ),
            )
            .orderBy(desc(kbEntries.number))
            .limit(1)
        )[0]?.number ?? 0;
      const parentEntries = graph.entries.filter((entry) => body.links.includes(entry.id));
      if (parentEntries.length !== body.links.length) {
        throw new ApiError(400, "link_target_missing", "One or more parent links do not exist");
      }
      const normalized = normalizeKbDraft({
        type: body.type,
        number: max + 1,
        slug: body.slug,
        frontmatter: body.frontmatter,
        bodyMd: body.bodyMd,
        parentEntries,
      });
      const draft = {
        id: "__draft__",
        type: body.type,
        number: max + 1,
        slug: body.slug,
        frontmatter: normalized.frontmatter,
        bodyMd: normalized.bodyMd,
        status: body.status,
        supersedes: null,
      };
      const report = validate({
        space: toHarnessSpace(space),
        entries: [...graph.entries, draft],
        links: [
          ...graph.links,
          ...parentEntries.flatMap((parent) => [
            { fromEntry: "__draft__", toEntry: parent.id },
            { fromEntry: parent.id, toEntry: "__draft__" },
          ]),
        ],
        entryId: "__draft__",
        validateSpecials: false,
      });
      if (!report.ok) {
        throw new ApiError(400, "kb_validation_failed", "KB entry failed validation", report);
      }
      if (dry) {
        return { ok: true, entry: draft, report };
      }
      const entry = await db.transaction(async (tx) => {
        const inserted = (
          await tx
            .insert(kbEntries)
            .values({
              id: newId("kb"),
              orgId: p.orgId,
              spaceId: space.id,
              type: body.type,
              number: max + 1,
              slug: body.slug,
              frontmatter: normalized.frontmatter,
              bodyMd: normalized.bodyMd,
              status: body.status,
            })
            .returning()
        )[0];
        if (!inserted) throw new ApiError(500, "insert_failed", "Could not create KB entry");
        const childArtifactId = artifactIdFor(toHarnessEntry(inserted));
        for (const link of body.links) {
          await tx
            .insert(kbLinks)
            .values([
              { orgId: p.orgId, spaceId: space.id, fromEntry: inserted.id, toEntry: link },
              { orgId: p.orgId, spaceId: space.id, fromEntry: link, toEntry: inserted.id },
            ])
            .onConflictDoNothing();
          const parent = parentEntries.find((candidate) => candidate.id === link);
          if (parent) {
            await tx
              .update(kbEntries)
              .set({
                bodyMd: ensureLinks(parent.bodyMd, [childArtifactId]),
                updatedAt: new Date(),
              })
              .where(and(eq(kbEntries.orgId, p.orgId), eq(kbEntries.id, parent.id)));
          }
        }
        await tx
          .update(kbSpaces)
          .set({ activeMd: ensureActive(space.activeMd, [childArtifactId]), updatedAt: new Date() })
          .where(and(eq(kbSpaces.orgId, p.orgId), eq(kbSpaces.id, space.id)));
        return inserted;
      });
      return entry;
    },
  );

  app.patch(
    "/v1/kb/entries/:entryId",
    {
      config: { permission: "kb:write", auditAction: "kb.updated" },
      schema: { params: IdParams, body: AnyObject, response: { 200: AnyObject } },
    },
    async (request) => {
      const p = principal(request);
      const { entryId } = request.params as { entryId: string };
      const current = (
        await db
          .select()
          .from(kbEntries)
          .where(and(eq(kbEntries.orgId, p.orgId), eq(kbEntries.id, entryId)))
          .limit(1)
      )[0];
      if (!current) throw notFound("KB entry not found");
      const space = (
        await db
          .select()
          .from(kbSpaces)
          .where(and(eq(kbSpaces.orgId, p.orgId), eq(kbSpaces.id, current.spaceId)))
          .limit(1)
      )[0];
      if (!space) throw notFound("KB space not found");
      const entries = await db
        .select()
        .from(kbEntries)
        .where(and(eq(kbEntries.orgId, p.orgId), eq(kbEntries.spaceId, current.spaceId)));
      const links = await db
        .select()
        .from(kbLinks)
        .where(and(eq(kbLinks.orgId, p.orgId), eq(kbLinks.spaceId, current.spaceId)));
      const patched = { ...current, ...(request.body as object), updatedAt: new Date() };
      const report = validate({
        space: toHarnessSpace(space),
        entries: entries.map((entry) => toHarnessEntry(entry.id === entryId ? patched : entry)),
        links: links.map((link) => ({ fromEntry: link.fromEntry, toEntry: link.toEntry })),
        entryId,
        validateSpecials: false,
      });
      if (!report.ok) {
        throw new ApiError(400, "kb_validation_failed", "KB entry failed validation", report);
      }
      return (
        await db
          .update(kbEntries)
          .set({ ...(request.body as object), updatedAt: new Date() })
          .where(and(eq(kbEntries.orgId, p.orgId), eq(kbEntries.id, entryId)))
          .returning()
      )[0];
    },
  );
  app.post(
    "/v1/projects/:projectId/kb/validate",
    {
      config: { permission: "kb:write", auditAction: "kb.updated" },
      schema: {
        params: IdParams,
        response: { 200: AnyObject },
      },
    },
    async (request) => {
      const p = principal(request);
      const { projectId } = request.params as { projectId: string };
      return validateProjectKb(db, p.orgId, projectId);
    },
  );

  app.post(
    "/v1/runs/:runId/kb-checkpoint",
    {
      config: { public: true },
      schema: { params: IdParams, response: { 200: AnyObject } },
    },
    async (request) => {
      const { runId } = request.params as { runId: string };
      const token = bearer(request.headers.authorization);
      if (!token) throw new ApiError(401, "unauthorized", "Runner token required");
      const run = (await db.select().from(runs).where(eq(runs.id, runId)).limit(1))[0];
      if (!run) throw notFound("Run not found");
      const sandbox = readSandbox(run.sandbox);
      if (!sandbox.runnerTokenHash || !(await verifyKey(token, sandbox.runnerTokenHash))) {
        throw new ApiError(401, "unauthorized", "Invalid runner token");
      }
      return validateProjectKb(db, run.orgId, run.projectId);
    },
  );

  async function spaceFor(orgId: string, projectId: string) {
    return (
      await db
        .select()
        .from(kbSpaces)
        .where(and(eq(kbSpaces.orgId, orgId), eq(kbSpaces.projectId, projectId)))
        .limit(1)
    )[0];
  }

  app.get(
    "/v1/projects/:projectId/tasks",
    {
      config: { permission: "tasks:read" },
      schema: { params: IdParams, response: { 200: z.array(AnyObject) } },
    },
    async (request) =>
      db
        .select()
        .from(poTasks)
        .where(
          and(
            eq(poTasks.orgId, principal(request).orgId),
            eq(poTasks.projectId, (request.params as { projectId: string }).projectId),
          ),
        ),
  );
  app.post(
    "/v1/projects/:projectId/tasks",
    {
      config: { permission: "tasks:write", auditAction: "task.updated" },
      schema: {
        params: IdParams,
        body: z.object({
          title: z.string(),
          bodyMd: z.string(),
          status: z.string().default("draft"),
          kbEntryId: z.string().optional(),
          wsjf: AnyObject.default({}),
        }),
        response: { 200: AnyObject },
      },
    },
    async (request) => {
      const body = request.body as {
        title: string;
        bodyMd: string;
        status: string;
        kbEntryId?: string;
        wsjf: Record<string, unknown>;
      };
      return (
        await db
          .insert(poTasks)
          .values({
            id: newId("task"),
            orgId: principal(request).orgId,
            projectId: (request.params as { projectId: string }).projectId,
            ...body,
          })
          .returning()
      )[0];
    },
  );
  app.patch(
    "/v1/projects/:projectId/tasks/:taskId",
    {
      config: { permission: "tasks:write", auditAction: "task.updated" },
      schema: {
        params: z.object({ projectId: z.string(), taskId: z.string() }),
        body: AnyObject,
        response: { 200: AnyObject },
      },
    },
    async (request) =>
      (
        await db
          .update(poTasks)
          .set({ ...(request.body as object), updatedAt: new Date() })
          .where(
            and(
              eq(poTasks.orgId, principal(request).orgId),
              eq(poTasks.id, (request.params as { taskId: string }).taskId),
            ),
          )
          .returning()
      )[0],
  );
  app.delete(
    "/v1/projects/:projectId/tasks/:taskId",
    {
      config: { permission: "tasks:write", auditAction: "task.updated" },
      schema: {
        params: z.object({ projectId: z.string(), taskId: z.string() }),
        response: { 200: Ok },
      },
    },
    async (request) => {
      await db
        .delete(poTasks)
        .where(
          and(
            eq(poTasks.orgId, principal(request).orgId),
            eq(poTasks.id, (request.params as { taskId: string }).taskId),
          ),
        );
      return { ok: true };
    },
  );
  app.post(
    "/v1/tasks/:taskId/transition",
    {
      config: { permission: "tasks:write", auditAction: "task.updated" },
      schema: {
        params: IdParams,
        body: z.object({ status: z.string() }),
        response: { 200: AnyObject },
      },
    },
    async (request) =>
      (
        await db
          .update(poTasks)
          .set({ status: (request.body as { status: string }).status, updatedAt: new Date() })
          .where(
            and(
              eq(poTasks.orgId, principal(request).orgId),
              eq(poTasks.id, (request.params as { taskId: string }).taskId),
            ),
          )
          .returning()
      )[0],
  );

  app.post(
    "/v1/tasks/:taskId/propose",
    {
      config: { permission: "tasks:write", auditAction: "task.proposed" },
      schema: { params: IdParams, response: { 200: AnyObject } },
    },
    async (request) => {
      const p = principal(request);
      const { taskId } = request.params as { taskId: string };
      const task = (
        await db
          .select()
          .from(poTasks)
          .where(and(eq(poTasks.orgId, p.orgId), eq(poTasks.id, taskId)))
          .limit(1)
      )[0];
      if (!task) throw notFound("Task not found");
      const actionType = await actionTypeByName(p.orgId, "task_creation");
      if (!actionType) throw notFound("Action type not found");
      const repo = (
        await db
          .select()
          .from(repos)
          .where(and(eq(repos.orgId, p.orgId), eq(repos.projectId, task.projectId)))
          .limit(1)
      )[0];
      const project = (
        await db
          .select()
          .from(projects)
          .where(and(eq(projects.orgId, p.orgId), eq(projects.id, task.projectId)))
          .limit(1)
      )[0];
      const board = objectOrEmpty(project?.settings).board;
      const proposal = (
        await db
          .insert(proposals)
          .values({
            id: newId("prop"),
            orgId: p.orgId,
            projectId: task.projectId,
            actionTypeId: actionType.id,
            payload: {
              taskId: task.id,
              title: task.title,
              bodyMd: task.bodyMd,
              wsjf: task.wsjf,
              target: {
                repo: repo ? { owner: repo.owner, name: repo.name } : null,
                board,
              },
            },
            contextMd: `Task creation proposal for ${task.title}`,
            expiresAt: new Date(Date.now() + actionType.defaultTtlHours * 3600_000),
          })
          .returning()
      )[0];
      if (!proposal) throw new ApiError(500, "insert_failed", "Could not create proposal");
      await db.insert(proposalEvents).values({
        orgId: p.orgId,
        proposalId: proposal.id,
        seq: 1,
        type: "open",
        actor: { type: p.type, id: p.id },
        data: {},
      });
      await db
        .update(poTasks)
        .set({ status: "proposed", updatedAt: new Date() })
        .where(eq(poTasks.id, task.id));
      return proposal;
    },
  );

  async function actionTypeByName(orgId: string, name: string) {
    return (
      await db
        .select()
        .from(actionTypes)
        .where(and(eq(actionTypes.orgId, orgId), eq(actionTypes.name, name)))
        .limit(1)
    )[0];
  }

  async function seedProjectHarnessAgents(orgId: string, projectId: string) {
    const items = await db
      .select()
      .from(registryItems)
      .where(and(eq(registryItems.orgId, orgId), eq(registryItems.scope, "bundled")));
    const byName = new Map(items.map((item) => [item.name, item]));
    const sandbox = (
      await db
        .select()
        .from(sandboxProfiles)
        .where(and(eq(sandboxProfiles.orgId, orgId), eq(sandboxProfiles.id, "sbx_dev_default")))
        .limit(1)
    )[0];
    const productChain = byName.get("product-chain");
    const poContract = byName.get("po-agent");
    const learningContract = byName.get("learning-agent");
    if (productChain && poContract) {
      await db
        .insert(agentDefs)
        .values({
          id: newId("agent"),
          orgId,
          projectId,
          name: "project-owner",
          engine: "codex",
          model: { primary: "gpt-5.5" },
          contractItemId: poContract.id,
          harnessItemId: productChain.id,
          triggers: [
            { type: "schedule", config: { cron: "0 6 * * *", timezone: "UTC" } },
            { type: "manual", config: {} },
          ],
          sandboxProfileId: sandbox?.id,
          permissions: ["kb:write", "tasks:write", "hitl:write"],
          enabled: false,
        })
        .onConflictDoNothing();
    }
    if (learningContract) {
      await db
        .insert(agentDefs)
        .values({
          id: newId("agent"),
          orgId,
          projectId,
          name: "learning",
          engine: "codex",
          model: { primary: "gpt-5.5" },
          contractItemId: learningContract.id,
          harnessItemId: productChain?.id,
          triggers: [{ type: "schedule", config: { cron: "0 3 * * *", timezone: "UTC" } }],
          sandboxProfileId: sandbox?.id,
          permissions: ["runs:read", "hitl:write", "kb:read"],
          enabled: false,
        })
        .onConflictDoNothing();
    }
  }

  registerCrud(app, "/v1/projects/:projectId/agents", "agents", agentDefs, "agent");
  registerCrud(app, "/v1/sandbox-profiles", "sandboxes", sandboxProfiles, "sbx");
}

async function streamRunEvents(
  config: AppConfig,
  reply: FastifyReply,
  runId: string,
  afterSeq: number,
  idleMs: number,
  load: (afterSeq: number) => Promise<unknown[]>,
) {
  reply.raw.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  const write = (event: string, data: unknown) =>
    reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  write("heartbeat", { ts: new Date().toISOString() });
  let cursor = afterSeq;
  const writeEvents = async (events: unknown[]) => {
    for (const event of events) {
      write("run_event", event);
      const seq =
        typeof event === "object" && event !== null ? (event as { seq?: unknown }).seq : undefined;
      if (typeof seq === "number" && seq > cursor) cursor = seq;
    }
  };
  await writeEvents(await load(cursor));
  if (idleMs <= 1_000) {
    const poll = setInterval(() => {
      void (async () => {
        await writeEvents(await load(cursor));
      })();
    }, 100);
    await new Promise((resolve) => setTimeout(resolve, idleMs));
    clearInterval(poll);
    reply.raw.end();
    return;
  }
  const sqlClient = postgres(config.databaseUrl, { max: 1 });
  let done = false;
  const close = () => {
    done = true;
  };
  reply.raw.on("close", close);
  let unlisten: { unlisten: () => Promise<void> } | undefined;
  try {
    void sqlClient
      .listen(`run_events:${runId}`, async () => {
        await writeEvents(await load(cursor));
      })
      .then((listener) => {
        unlisten = listener;
      })
      .catch(async () => {
        await writeEvents(await load(cursor));
      });
    const poll = setInterval(() => {
      void (async () => {
        await writeEvents(await load(cursor));
      })();
    }, 250);
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, idleMs);
      reply.raw.on("close", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    clearInterval(poll);
    if (!done) reply.raw.end();
    void unlisten?.unlisten().catch(() => undefined);
  } finally {
    reply.raw.off("close", close);
    void sqlClient.end().catch(() => undefined);
  }
}

function bearer(value: string | undefined) {
  if (!value?.startsWith("Bearer ")) return null;
  return value.slice("Bearer ".length);
}

function objectOrEmpty(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function registerCrud(
  app: FastifyInstance,
  base: string,
  permissionResource: string,
  // biome-ignore lint/suspicious/noExplicitAny: this CRUD helper is intentionally table-generic.
  table: any,
  prefix: "agent" | "sbx",
) {
  app.get(
    base,
    {
      config: { permission: `${permissionResource}:read` },
      schema: { params: IdParams, response: { 200: z.array(AnyObject) } },
    },
    async (request) => {
      const p = principal(request);
      const params = request.params as { projectId?: string };
      const clauses = [eq(table.orgId, p.orgId)];
      if (params.projectId && table.projectId) clauses.push(eq(table.projectId, params.projectId));
      return app.facilityDb
        .select()
        .from(table)
        .where(and(...clauses));
    },
  );
  app.post(
    base,
    {
      config: {
        permission: `${permissionResource}:write`,
        auditAction: `${permissionResource}.updated`,
      },
      schema: { params: IdParams, body: AnyObject, response: { 200: AnyObject } },
    },
    async (request) => {
      const p = principal(request);
      const params = request.params as { projectId?: string };
      return (
        await app.facilityDb
          .insert(table)
          .values({
            id: newId(prefix),
            orgId: p.orgId,
            projectId: params.projectId,
            ...(request.body as object),
          })
          .returning()
      )[0];
    },
  );
  app.patch(
    `${base}/:id`,
    {
      config: {
        permission: `${permissionResource}:write`,
        auditAction: `${permissionResource}.updated`,
      },
      schema: {
        params: z.object({ projectId: z.string().optional(), id: z.string() }),
        body: AnyObject,
        response: { 200: AnyObject },
      },
    },
    async (request) => {
      const p = principal(request);
      const { id } = request.params as { id: string };
      return (
        await app.facilityDb
          .update(table)
          .set({ ...(request.body as object), updatedAt: new Date() })
          .where(and(eq(table.orgId, p.orgId), eq(table.id, id)))
          .returning()
      )[0];
    },
  );
  app.delete(
    `${base}/:id`,
    {
      config: {
        permission: `${permissionResource}:write`,
        auditAction: `${permissionResource}.updated`,
      },
      schema: {
        params: z.object({ projectId: z.string().optional(), id: z.string() }),
        response: { 200: Ok },
      },
    },
    async (request) => {
      const p = principal(request);
      const { id } = request.params as { id: string };
      await app.facilityDb.delete(table).where(and(eq(table.orgId, p.orgId), eq(table.id, id)));
      return { ok: true };
    },
  );
}
