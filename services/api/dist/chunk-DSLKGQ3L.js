import {
  readConfig
} from "./chunk-E4CVFKPO.js";

// src/app.ts
import { can, keyLookup, newId as newId2, open, seal as seal2, verifyKey } from "@facility/core";
import {
  apiKeys as apiKeys2,
  createDb,
  insertAuditEvent,
  orgMembers as orgMembers2,
  orgs as orgs3,
  projects as projects2,
  roles as rolesTable,
  users as users2
} from "@facility/db";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { and as and2, eq as eq3, isNull as isNull2, or as or2 } from "drizzle-orm";
import Fastify from "fastify";
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler
} from "fastify-type-provider-zod";
import PgBoss from "pg-boss";
import { uuidv7 } from "uuidv7";
import { z as z3 } from "zod";

// src/errors.ts
var ApiError = class extends Error {
  constructor(statusCode, code, message, details) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
  statusCode;
  code;
  details;
};
function sendError(reply, error) {
  return reply.status(error.statusCode).send({
    error: { code: error.code, message: error.message, details: error.details }
  });
}
var notFound = (message = "Not found") => new ApiError(404, "not_found", message);

// src/routes/auth.ts
import { orgs } from "@facility/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
var EmptyResponse = z.object({ ok: z.boolean() });
async function registerAuthRoutes(app, config) {
  app.get(
    "/auth/login",
    {
      config: { public: true },
      schema: { response: { 302: z.unknown(), 501: z.object({ error: z.unknown() }) } }
    },
    async (_request, reply) => {
      if (!config.workosClientId) {
        throw new ApiError(501, "workos_unconfigured", "WorkOS login is not configured");
      }
      const redirectUri = `${config.publicUrl}/auth/callback`;
      const url = new URL("https://api.workos.com/user_management/authorize");
      url.searchParams.set("client_id", config.workosClientId);
      url.searchParams.set("redirect_uri", redirectUri);
      url.searchParams.set("response_type", "code");
      return reply.redirect(url.toString());
    }
  );
  app.get(
    "/auth/callback",
    {
      config: { public: true },
      schema: {
        querystring: z.object({ code: z.string().optional() }),
        response: { 302: z.unknown(), 501: z.object({ error: z.unknown() }) }
      }
    },
    async () => {
      throw new ApiError(
        501,
        "workos_unconfigured",
        "WorkOS callback exchange is not configured in this build"
      );
    }
  );
  app.post(
    "/auth/dev-login",
    {
      config: { public: true },
      schema: {
        body: z.object({ email: z.string().email() }),
        response: {
          200: z.object({ ok: z.boolean(), orgId: z.string(), userId: z.string() })
        }
      }
    },
    async (request, reply) => {
      if (!config.facilityInsecureDev) {
        throw new ApiError(404, "not_found", "Dev login is disabled");
      }
      const { email } = request.body;
      const session = await ensureDevUser(app.facilityDb, email);
      const sealed = await mintSessionCookie(config, session.userId, session.orgId);
      reply.setCookie("facility_session", sealed, {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        signed: true,
        secure: false
      });
      await request.audit("auth.login", { type: "user", id: session.userId });
      return { ok: true, ...session };
    }
  );
  app.post(
    "/auth/logout",
    {
      config: { public: true },
      schema: { response: { 200: EmptyResponse } }
    },
    async (request, reply) => {
      if (request.principal) {
        await request.audit("auth.logout", {
          type: request.principal.type,
          id: request.principal.id
        });
      }
      reply.clearCookie("facility_session", { path: "/" });
      return { ok: true };
    }
  );
  app.get(
    "/auth/default-org",
    {
      config: { permission: "org:read" },
      schema: { response: { 200: z.object({ id: z.string(), slug: z.string() }) } }
    },
    async (request) => {
      const principal2 = request.principal;
      if (!principal2) throw new ApiError(401, "unauthorized", "Authentication required");
      const org = (await app.facilityDb.select().from(orgs).where(eq(orgs.id, principal2.orgId)).limit(1))[0];
      if (!org) throw new ApiError(404, "not_found", "Organization not found");
      return { id: org.id, slug: org.slug };
    }
  );
}

// src/routes/v1.ts
import { generateApiKey, newId, seal } from "@facility/core";
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
  orgs as orgs2,
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
  withOrg
} from "@facility/db";
import { and, asc, desc, eq as eq2, gte, isNull, lte, or, sql } from "drizzle-orm";
import { z as z2 } from "zod";
var AnyObject = z2.record(z2.string(), z2.unknown());
var Ok = z2.object({ ok: z2.boolean() });
var IdParams = z2.object({
  projectId: z2.string().optional(),
  runId: z2.string().optional(),
  itemId: z2.string().optional(),
  versionId: z2.string().optional(),
  proposalId: z2.string().optional(),
  entryId: z2.string().optional(),
  taskId: z2.string().optional(),
  issueId: z2.string().optional(),
  keyId: z2.string().optional(),
  userId: z2.string().optional(),
  roleId: z2.string().optional()
});
function principal(request) {
  if (!request.principal) throw new ApiError(401, "unauthorized", "Authentication required");
  return request.principal;
}
function publicRow(row) {
  const { hash: _hash, sealedSecret: _sealedSecret, sealed_secret: _sealedSecret2, ...rest } = row;
  return rest;
}
async function registerV1Routes(app, config) {
  const db = app.facilityDb;
  app.get(
    "/v1/me",
    {
      config: { permission: "org:read" },
      schema: {
        response: {
          200: z2.object({ principal: AnyObject, org: AnyObject, permissions: z2.array(z2.string()) })
        }
      }
    },
    async (request) => {
      const p = principal(request);
      const org = (await db.select().from(orgs2).where(eq2(orgs2.id, p.orgId)).limit(1))[0];
      return { principal: p, org, permissions: p.permissions };
    }
  );
  app.get(
    "/v1/org",
    {
      config: { permission: "org:read" },
      schema: { response: { 200: AnyObject } }
    },
    async (request) => {
      const p = principal(request);
      return (await db.select().from(orgs2).where(eq2(orgs2.id, p.orgId)).limit(1))[0] ?? null;
    }
  );
  app.patch(
    "/v1/org",
    {
      config: { permission: "org:write", auditAction: "org.updated" },
      schema: {
        body: z2.object({ name: z2.string().optional(), settings: AnyObject.optional() }),
        response: { 200: AnyObject }
      }
    },
    async (request) => {
      const p = principal(request);
      const body = request.body;
      return (await db.update(orgs2).set({ name: body.name, settings: body.settings, updatedAt: /* @__PURE__ */ new Date() }).where(eq2(orgs2.id, p.orgId)).returning())[0];
    }
  );
  app.get(
    "/v1/members",
    { config: { permission: "members:read" }, schema: { response: { 200: z2.array(AnyObject) } } },
    async (request) => {
      const p = principal(request);
      return db.select({ member: orgMembers, user: users, role: roles }).from(orgMembers).innerJoin(users, eq2(orgMembers.userId, users.id)).innerJoin(roles, eq2(orgMembers.roleId, roles.id)).where(eq2(orgMembers.orgId, p.orgId));
    }
  );
  app.post(
    "/v1/members",
    {
      config: { permission: "members:write", auditAction: "member.added" },
      schema: {
        body: z2.object({ email: z2.string().email(), roleId: z2.string() }),
        response: { 200: AnyObject }
      }
    },
    async (request) => {
      const p = principal(request);
      const body = request.body;
      const existing = (await db.select().from(users).where(eq2(users.email, body.email)).limit(1))[0];
      const user = existing ?? (await db.insert(users).values({ id: newId("user"), email: body.email, status: "active" }).returning())[0];
      if (!user) throw new ApiError(500, "insert_failed", "Could not create user");
      return (await db.insert(orgMembers).values({ id: newId("user"), orgId: p.orgId, userId: user.id, roleId: body.roleId }).onConflictDoUpdate({
        target: [orgMembers.orgId, orgMembers.userId],
        set: { roleId: body.roleId, updatedAt: /* @__PURE__ */ new Date() }
      }).returning())[0];
    }
  );
  app.patch(
    "/v1/members/:userId",
    {
      config: { permission: "members:write", auditAction: "member.updated" },
      schema: {
        params: IdParams,
        body: z2.object({ roleId: z2.string() }),
        response: { 200: AnyObject }
      }
    },
    async (request) => {
      const p = principal(request);
      const { userId } = request.params;
      const { roleId } = request.body;
      const row = (await db.update(orgMembers).set({ roleId, updatedAt: /* @__PURE__ */ new Date() }).where(and(eq2(orgMembers.orgId, p.orgId), eq2(orgMembers.userId, userId))).returning())[0];
      if (!row) throw notFound("Member not found");
      return row;
    }
  );
  app.delete(
    "/v1/members/:userId",
    {
      config: { permission: "members:write", auditAction: "member.removed" },
      schema: { params: IdParams, response: { 200: Ok } }
    },
    async (request) => {
      const p = principal(request);
      const { userId } = request.params;
      await db.delete(orgMembers).where(and(eq2(orgMembers.orgId, p.orgId), eq2(orgMembers.userId, userId)));
      return { ok: true };
    }
  );
  app.get(
    "/v1/roles",
    { config: { permission: "roles:read" }, schema: { response: { 200: z2.array(AnyObject) } } },
    async (request) => {
      const p = principal(request);
      return db.select().from(roles).where(or(isNull(roles.orgId), eq2(roles.orgId, p.orgId)));
    }
  );
  app.post(
    "/v1/roles",
    {
      config: { permission: "roles:write", auditAction: "role.created" },
      schema: {
        body: z2.object({
          name: z2.string(),
          description: z2.string().optional(),
          permissions: z2.array(z2.string())
        }),
        response: { 200: AnyObject }
      }
    },
    async (request) => {
      const p = principal(request);
      const body = request.body;
      return (await db.insert(roles).values({ id: newId("key"), orgId: p.orgId, ...body }).returning())[0];
    }
  );
  app.patch(
    "/v1/roles/:roleId",
    {
      config: { permission: "roles:write", auditAction: "role.updated" },
      schema: {
        params: IdParams,
        body: z2.object({
          description: z2.string().optional(),
          permissions: z2.array(z2.string()).optional()
        }),
        response: { 200: AnyObject }
      }
    },
    async (request) => {
      const p = principal(request);
      const { roleId } = request.params;
      const role = (await db.select().from(roles).where(eq2(roles.id, roleId)).limit(1))[0];
      if (!role) throw notFound("Role not found");
      if (!role.orgId) throw new ApiError(400, "bundled_immutable", "Bundled roles are immutable");
      return (await db.update(roles).set({ ...request.body, updatedAt: /* @__PURE__ */ new Date() }).where(and(eq2(roles.id, roleId), eq2(roles.orgId, p.orgId))).returning())[0];
    }
  );
  app.delete(
    "/v1/roles/:roleId",
    {
      config: { permission: "roles:write", auditAction: "role.deleted" },
      schema: { params: IdParams, response: { 200: Ok } }
    },
    async (request) => {
      const p = principal(request);
      const { roleId } = request.params;
      const role = (await db.select().from(roles).where(eq2(roles.id, roleId)).limit(1))[0];
      if (role && !role.orgId)
        throw new ApiError(400, "bundled_immutable", "Bundled roles are immutable");
      await db.delete(roles).where(and(eq2(roles.id, roleId), eq2(roles.orgId, p.orgId)));
      return { ok: true };
    }
  );
  app.get(
    "/v1/keys",
    { config: { permission: "keys:issue" }, schema: { response: { 200: z2.array(AnyObject) } } },
    async (request) => {
      const p = principal(request);
      return (await db.select().from(apiKeys).where(eq2(apiKeys.orgId, p.orgId))).map(publicRow);
    }
  );
  app.post(
    "/v1/keys",
    {
      config: { permission: "keys:issue", auditAction: "key.issued" },
      schema: {
        body: z2.object({ name: z2.string(), roleId: z2.string(), projectId: z2.string().optional() }),
        response: { 200: AnyObject }
      }
    },
    async (request) => {
      const p = principal(request);
      const body = request.body;
      const key = await generateApiKey("fak");
      const row = (await db.insert(apiKeys).values({
        id: key.id,
        orgId: p.orgId,
        name: body.name,
        prefix: key.lookup,
        last4: key.last4,
        hash: key.hash,
        scopeType: body.projectId ? "project" : "org",
        projectId: body.projectId,
        roleId: body.roleId,
        createdBy: p.id
      }).returning())[0];
      await request.audit(
        "key.issued",
        { type: "key", id: key.id },
        { name: body.name, last4: key.last4 }
      );
      return { ...publicRow(row ?? {}), secret: key.secret };
    }
  );
  app.delete(
    "/v1/keys/:keyId",
    {
      config: { permission: "keys:issue", auditAction: "key.revoked" },
      schema: { params: IdParams, response: { 200: Ok } }
    },
    async (request) => {
      const p = principal(request);
      const { keyId } = request.params;
      await db.update(apiKeys).set({ revokedAt: /* @__PURE__ */ new Date() }).where(and(eq2(apiKeys.orgId, p.orgId), eq2(apiKeys.id, keyId)));
      await request.audit("key.revoked", { type: "key", id: keyId });
      return { ok: true };
    }
  );
  app.get(
    "/v1/projects",
    {
      config: { permission: "projects:read" },
      schema: {
        querystring: z2.object({ status: z2.string().optional() }),
        response: { 200: z2.array(AnyObject) }
      }
    },
    async (request) => {
      const p = principal(request);
      const query = request.query;
      return withOrg(db, p.orgId).projects.list(query);
    }
  );
  app.post(
    "/v1/projects",
    {
      config: { permission: "projects:write", auditAction: "project.created" },
      schema: {
        body: z2.object({
          name: z2.string(),
          slug: z2.string(),
          description: z2.string().optional(),
          settings: AnyObject.optional()
        }),
        response: { 200: AnyObject }
      }
    },
    async (request) => {
      const p = principal(request);
      const body = request.body;
      return (await db.insert(projects).values({
        id: newId("proj"),
        orgId: p.orgId,
        name: body.name,
        slug: body.slug,
        description: body.description,
        settings: body.settings ?? { default_branch: "main", check_cmds: [] }
      }).returning())[0];
    }
  );
  app.get(
    "/v1/projects/:projectId",
    {
      config: { permission: "projects:read" },
      schema: { params: IdParams, response: { 200: AnyObject } }
    },
    async (request) => {
      const p = principal(request);
      const { projectId } = request.params;
      const row = await withOrg(db, p.orgId).projects.byId(projectId);
      if (!row) throw notFound("Project not found");
      return row;
    }
  );
  app.patch(
    "/v1/projects/:projectId",
    {
      config: { permission: "projects:write", auditAction: "project.updated" },
      schema: {
        params: IdParams,
        body: z2.object({
          name: z2.string().optional(),
          description: z2.string().optional(),
          status: z2.string().optional(),
          settings: AnyObject.optional()
        }),
        response: { 200: AnyObject }
      }
    },
    async (request) => {
      const p = principal(request);
      const { projectId } = request.params;
      return (await db.update(projects).set({ ...request.body, updatedAt: /* @__PURE__ */ new Date() }).where(and(eq2(projects.orgId, p.orgId), eq2(projects.id, projectId))).returning())[0];
    }
  );
  app.delete(
    "/v1/projects/:projectId",
    {
      config: { permission: "projects:write", auditAction: "project.deleted" },
      schema: { params: IdParams, response: { 200: Ok } }
    },
    async (request) => {
      const p = principal(request);
      const { projectId } = request.params;
      await db.update(projects).set({ status: "archived", updatedAt: /* @__PURE__ */ new Date() }).where(and(eq2(projects.orgId, p.orgId), eq2(projects.id, projectId)));
      return { ok: true };
    }
  );
  app.get(
    "/v1/projects/:projectId/repos",
    {
      config: { permission: "repos:read" },
      schema: { params: IdParams, response: { 200: z2.array(AnyObject) } }
    },
    async (request) => {
      const p = principal(request);
      const { projectId } = request.params;
      return withOrg(db, p.orgId).repos.listForProject(projectId);
    }
  );
  app.post(
    "/v1/projects/:projectId/repos",
    {
      config: { permission: "repos:write", auditAction: "repo.added" },
      schema: {
        params: IdParams,
        body: z2.object({
          owner: z2.string(),
          name: z2.string(),
          defaultBranch: z2.string().default("main")
        }),
        response: { 200: AnyObject }
      }
    },
    async (request) => {
      const p = principal(request);
      const { projectId } = request.params;
      const body = request.body;
      return (await db.insert(repos).values({ id: newId("repo"), orgId: p.orgId, projectId, ...body }).returning())[0];
    }
  );
  app.delete(
    "/v1/projects/:projectId/repos/:repoId",
    {
      config: { permission: "repos:write", auditAction: "repo.removed" },
      schema: {
        params: z2.object({ projectId: z2.string(), repoId: z2.string() }),
        response: { 200: Ok }
      }
    },
    async (request) => {
      const p = principal(request);
      const { projectId, repoId } = request.params;
      await db.delete(repos).where(and(eq2(repos.orgId, p.orgId), eq2(repos.projectId, projectId), eq2(repos.id, repoId)));
      return { ok: true };
    }
  );
  app.get(
    "/v1/registry/items",
    {
      config: { permission: "registry:read" },
      schema: {
        querystring: z2.object({
          kind: z2.string().optional(),
          scope: z2.string().optional(),
          projectId: z2.string().optional()
        }),
        response: { 200: z2.array(AnyObject) }
      }
    },
    async (request) => {
      const p = principal(request);
      const q = request.query;
      const clauses = [eq2(registryItems.orgId, p.orgId)];
      if (q.kind) clauses.push(eq2(registryItems.kind, q.kind));
      if (q.scope) clauses.push(eq2(registryItems.scope, q.scope));
      if (q.projectId) clauses.push(eq2(registryItems.projectId, q.projectId));
      return db.select().from(registryItems).where(and(...clauses));
    }
  );
  app.get(
    "/v1/registry/items/:itemId",
    {
      config: { permission: "registry:read" },
      schema: { params: IdParams, response: { 200: AnyObject } }
    },
    async (request) => {
      const p = principal(request);
      const { itemId } = request.params;
      const item = (await db.select().from(registryItems).where(and(eq2(registryItems.orgId, p.orgId), eq2(registryItems.id, itemId))).limit(1))[0];
      if (!item) throw notFound("Registry item not found");
      const versions = await db.select().from(registryVersions).where(and(eq2(registryVersions.orgId, p.orgId), eq2(registryVersions.itemId, itemId))).orderBy(asc(registryVersions.version));
      return { ...item, versions };
    }
  );
  app.post(
    "/v1/registry/items",
    {
      config: { permission: "registry:write", auditAction: "registry.created" },
      schema: {
        body: z2.object({
          scope: z2.string(),
          projectId: z2.string().optional(),
          kind: z2.string(),
          name: z2.string(),
          description: z2.string().optional(),
          content: z2.string()
        }),
        response: { 200: AnyObject }
      }
    },
    async (request) => {
      const p = principal(request);
      const body = request.body;
      const item = (await db.insert(registryItems).values({
        id: newId("item"),
        orgId: p.orgId,
        scope: body.scope,
        projectId: body.projectId,
        kind: body.kind,
        name: body.name,
        description: body.description,
        latestVersion: 0
      }).returning())[0];
      if (!item) throw new ApiError(500, "insert_failed", "Could not create item");
      const version = await createRegistryVersion(p.orgId, item.id, 1, body.content, "draft", p.id);
      return { ...item, versions: [version] };
    }
  );
  async function createRegistryVersion(orgId, itemId, version, content, status, createdBy) {
    const { createHash } = await import("crypto");
    return (await db.insert(registryVersions).values({
      id: newId("ver"),
      orgId,
      itemId,
      version,
      content,
      contentHash: createHash("sha256").update(content).digest("hex"),
      status,
      createdBy
    }).returning())[0];
  }
  app.post(
    "/v1/registry/items/:itemId/versions",
    {
      config: { permission: "registry:write", auditAction: "registry.versioned" },
      schema: {
        params: IdParams,
        body: z2.object({ content: z2.string(), changelog: z2.string().optional() }),
        response: { 200: AnyObject }
      }
    },
    async (request) => {
      const p = principal(request);
      const { itemId } = request.params;
      const max = (await db.select().from(registryVersions).where(and(eq2(registryVersions.orgId, p.orgId), eq2(registryVersions.itemId, itemId))).orderBy(desc(registryVersions.version)).limit(1))[0]?.version ?? 0;
      return createRegistryVersion(
        p.orgId,
        itemId,
        max + 1,
        request.body.content,
        "draft",
        p.id
      );
    }
  );
  app.post(
    "/v1/registry/versions/:versionId/publish",
    {
      config: { permission: "registry:publish", auditAction: "registry.published" },
      schema: { params: IdParams, response: { 200: AnyObject } }
    },
    async (request) => {
      const p = principal(request);
      const { versionId } = request.params;
      const version = (await db.update(registryVersions).set({ status: "active", updatedAt: /* @__PURE__ */ new Date() }).where(
        and(
          eq2(registryVersions.orgId, p.orgId),
          eq2(registryVersions.id, versionId),
          eq2(registryVersions.status, "draft")
        )
      ).returning())[0];
      if (!version)
        throw new ApiError(400, "invalid_state", "Only draft versions can be published");
      await db.update(registryItems).set({ latestVersion: version.version }).where(and(eq2(registryItems.orgId, p.orgId), eq2(registryItems.id, version.itemId)));
      return version;
    }
  );
  app.post(
    "/v1/registry/versions/:versionId/deprecate",
    {
      config: { permission: "registry:publish", auditAction: "registry.deprecated" },
      schema: { params: IdParams, response: { 200: AnyObject } }
    },
    async (request) => {
      const p = principal(request);
      const { versionId } = request.params;
      return (await db.update(registryVersions).set({ status: "deprecated", updatedAt: /* @__PURE__ */ new Date() }).where(and(eq2(registryVersions.orgId, p.orgId), eq2(registryVersions.id, versionId))).returning())[0];
    }
  );
  app.get(
    "/v1/projects/:projectId/runs",
    {
      config: { permission: "runs:read" },
      schema: {
        params: IdParams,
        querystring: z2.object({ status: z2.string().optional() }),
        response: { 200: z2.array(AnyObject) }
      }
    },
    async (request) => {
      const p = principal(request);
      const { projectId } = request.params;
      return withOrg(db, p.orgId).runs.listForProject(
        projectId,
        request.query
      );
    }
  );
  app.post(
    "/v1/projects/:projectId/runs",
    {
      config: { permission: "runs:trigger", auditAction: "run.started" },
      schema: {
        params: IdParams,
        body: z2.object({
          mode: z2.string().default("builder"),
          engine: z2.string().default("codex"),
          trigger: AnyObject.optional(),
          agentDefId: z2.string().optional()
        }),
        response: { 200: AnyObject }
      }
    },
    async (request) => {
      const p = principal(request);
      const { projectId } = request.params;
      const body = request.body;
      const run = (await db.insert(runs).values({
        id: newId("run"),
        orgId: p.orgId,
        projectId,
        agentDefId: body.agentDefId,
        mode: body.mode,
        engine: body.engine,
        trigger: body.trigger ?? {},
        createdBy: { type: p.type, id: p.id }
      }).returning())[0];
      if (run) {
        await db.insert(runEvents).values({
          orgId: p.orgId,
          runId: run.id,
          seq: 1,
          type: "queued",
          data: { queue: "runs.dispatch" }
        });
        await app.enqueue("runs.dispatch", { runId: run.id, orgId: p.orgId });
      }
      return run;
    }
  );
  async function loadRun(p, runId) {
    const row = await withOrg(db, p.orgId).runs.byId(runId);
    if (!row) throw notFound("Run not found");
    if (p.projectId && row.projectId !== p.projectId) throw notFound("Run not found");
    return row;
  }
  async function nextRunEventSeq(dbx, runId) {
    const rows = await dbx.select({ max: sql`coalesce(max(seq), 0)` }).from(runEvents).where(eq2(runEvents.runId, runId));
    return Number(rows[0]?.max ?? 0) + 1;
  }
  app.get(
    "/v1/runs/:runId",
    {
      config: { permission: "runs:read" },
      schema: { params: IdParams, response: { 200: AnyObject } }
    },
    async (request) => {
      const p = principal(request);
      const { runId } = request.params;
      return loadRun(p, runId);
    }
  );
  app.post(
    "/v1/runs/:runId/cancel",
    {
      config: { permission: "runs:write", auditAction: "run.canceled" },
      schema: { params: IdParams, response: { 200: AnyObject } }
    },
    async (request) => {
      const p = principal(request);
      const { runId } = request.params;
      await loadRun(p, runId);
      const row = (await db.update(runs).set({ status: "canceled", endedAt: /* @__PURE__ */ new Date() }).where(and(eq2(runs.orgId, p.orgId), eq2(runs.id, runId))).returning())[0];
      if (!row) throw notFound("Run not found");
      return row;
    }
  );
  app.get(
    "/v1/runs/:runId/events",
    {
      config: { permission: "runs:read" },
      schema: {
        params: IdParams,
        querystring: z2.object({ afterSeq: z2.coerce.number().optional() }),
        response: { 200: z2.array(AnyObject) }
      }
    },
    async (request) => {
      const p = principal(request);
      const { runId } = request.params;
      const { afterSeq = 0 } = request.query;
      await loadRun(p, runId);
      return withOrg(db, p.orgId).runEvents.listAfter(runId, afterSeq);
    }
  );
  app.get(
    "/v1/runs/:runId/stream",
    {
      config: { permission: "runs:read" },
      schema: {
        params: IdParams,
        querystring: z2.object({ afterSeq: z2.coerce.number().optional() })
      }
    },
    async (request, reply) => {
      const p = principal(request);
      const { runId } = request.params;
      const { afterSeq = 0 } = request.query;
      await loadRun(p, runId);
      await streamRunEvents(
        reply,
        async () => withOrg(db, p.orgId).runEvents.listAfter(runId, afterSeq, 10)
      );
    }
  );
  app.post(
    "/v1/runs/:runId/steer",
    {
      config: { permission: "runs:steer", auditAction: "run.steered" },
      schema: {
        params: IdParams,
        body: z2.object({ body: z2.string().min(1) }),
        response: { 200: AnyObject }
      }
    },
    async (request) => {
      const p = principal(request);
      const { runId } = request.params;
      const run = await loadRun(p, runId);
      if (["succeeded", "failed", "canceled"].includes(run.status)) {
        throw new ApiError(409, "run_terminal", "Cannot steer a finished run");
      }
      const message = (await db.insert(steerMessages).values({
        id: newId("evt"),
        orgId: p.orgId,
        runId,
        authorUserId: p.userId,
        body: request.body.body
      }).returning())[0];
      await db.insert(runEvents).values({
        orgId: p.orgId,
        runId,
        seq: await nextRunEventSeq(db, runId),
        type: "steer",
        data: { text: request.body.body, author: p.id }
      });
      return message;
    }
  );
  app.get(
    "/v1/providers",
    { config: { permission: "providers:read" }, schema: { response: { 200: z2.array(AnyObject) } } },
    async (request) => {
      const p = principal(request);
      return (await db.select().from(providerCredentials).where(eq2(providerCredentials.orgId, p.orgId))).map((row) => ({
        id: row.id,
        provider: row.provider,
        name: row.name,
        baseUrl: row.baseUrl,
        createdAt: row.createdAt
      }));
    }
  );
  app.post(
    "/v1/providers",
    {
      config: { permission: "providers:write", auditAction: "provider.created" },
      schema: {
        body: z2.object({
          provider: z2.string(),
          name: z2.string(),
          baseUrl: z2.string().optional(),
          secret: z2.string()
        }),
        response: { 200: AnyObject }
      }
    },
    async (request) => {
      const p = principal(request);
      const body = request.body;
      const sealedSecret = await seal(body.secret, config.secretMasterKey);
      const row = (await db.insert(providerCredentials).values({
        id: newId("key"),
        orgId: p.orgId,
        provider: body.provider,
        name: body.name,
        baseUrl: body.baseUrl,
        sealedSecret,
        createdBy: p.id
      }).returning())[0];
      return row ? {
        id: row.id,
        provider: row.provider,
        name: row.name,
        baseUrl: row.baseUrl,
        createdAt: row.createdAt
      } : null;
    }
  );
  app.delete(
    "/v1/providers/:providerId",
    {
      config: { permission: "providers:write", auditAction: "provider.deleted" },
      schema: { params: z2.object({ providerId: z2.string() }), response: { 200: Ok } }
    },
    async (request) => {
      const p = principal(request);
      await db.delete(providerCredentials).where(
        and(
          eq2(providerCredentials.orgId, p.orgId),
          eq2(providerCredentials.id, request.params.providerId)
        )
      );
      return { ok: true };
    }
  );
  app.post(
    "/v1/projects/:projectId/virtual-keys",
    {
      config: { permission: "keys:issue", auditAction: "key.issued" },
      schema: {
        params: IdParams,
        body: z2.object({
          name: z2.string(),
          allowedModels: z2.array(z2.string()).optional(),
          expiresAt: z2.string().optional()
        }),
        response: { 200: AnyObject }
      }
    },
    async (request) => {
      const p = principal(request);
      const { projectId } = request.params;
      const body = request.body;
      const key = await generateApiKey("fvk");
      const row = (await db.insert(virtualKeys).values({
        id: key.id,
        orgId: p.orgId,
        projectId,
        name: body.name,
        prefix: "fvk",
        last4: key.last4,
        hash: key.hash,
        allowedModels: body.allowedModels,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : void 0
      }).returning())[0];
      return { ...publicRow(row ?? {}), secret: key.secret };
    }
  );
  app.get(
    "/v1/projects/:projectId/virtual-keys",
    {
      config: { permission: "keys:issue" },
      schema: { params: IdParams, response: { 200: z2.array(AnyObject) } }
    },
    async (request) => {
      const p = principal(request);
      const { projectId } = request.params;
      return (await db.select().from(virtualKeys).where(and(eq2(virtualKeys.orgId, p.orgId), eq2(virtualKeys.projectId, projectId)))).map(publicRow);
    }
  );
  app.delete(
    "/v1/projects/:projectId/virtual-keys/:keyId",
    {
      config: { permission: "keys:issue", auditAction: "key.revoked" },
      schema: {
        params: z2.object({ projectId: z2.string(), keyId: z2.string() }),
        response: { 200: Ok }
      }
    },
    async (request) => {
      const p = principal(request);
      const { keyId } = request.params;
      await db.update(virtualKeys).set({ revokedAt: /* @__PURE__ */ new Date() }).where(and(eq2(virtualKeys.orgId, p.orgId), eq2(virtualKeys.id, keyId)));
      return { ok: true };
    }
  );
  app.get(
    "/v1/budgets",
    { config: { permission: "budgets:read" }, schema: { response: { 200: z2.array(AnyObject) } } },
    async (request) => db.select().from(budgets).where(eq2(budgets.orgId, principal(request).orgId))
  );
  app.post(
    "/v1/budgets",
    {
      config: { permission: "budgets:write", auditAction: "budget.breached" },
      schema: {
        body: z2.object({
          scope: z2.string(),
          projectId: z2.string().optional(),
          agentDefId: z2.string().optional(),
          period: z2.string(),
          limitCents: z2.number().int(),
          mode: z2.string(),
          enabled: z2.boolean().default(true)
        }),
        response: { 200: AnyObject }
      }
    },
    async (request) => {
      const body = request.body;
      return (await db.insert(budgets).values({ id: newId("bud"), orgId: principal(request).orgId, ...body }).returning())[0];
    }
  );
  app.patch(
    "/v1/budgets/:budgetId",
    {
      config: { permission: "budgets:write", auditAction: "budget.breached" },
      schema: {
        params: z2.object({ budgetId: z2.string() }),
        body: AnyObject,
        response: { 200: AnyObject }
      }
    },
    async (request) => (await db.update(budgets).set({ ...request.body, updatedAt: /* @__PURE__ */ new Date() }).where(
      and(
        eq2(budgets.orgId, principal(request).orgId),
        eq2(budgets.id, request.params.budgetId)
      )
    ).returning())[0]
  );
  app.delete(
    "/v1/budgets/:budgetId",
    {
      config: { permission: "budgets:write", auditAction: "budget.breached" },
      schema: { params: z2.object({ budgetId: z2.string() }), response: { 200: Ok } }
    },
    async (request) => {
      await db.delete(budgets).where(
        and(
          eq2(budgets.orgId, principal(request).orgId),
          eq2(budgets.id, request.params.budgetId)
        )
      );
      return { ok: true };
    }
  );
  app.get(
    "/v1/spend",
    {
      config: { permission: "spend:read" },
      schema: {
        querystring: z2.object({
          projectId: z2.string().optional(),
          from: z2.string().optional(),
          to: z2.string().optional(),
          groupBy: z2.enum(["model", "agent", "day"]).optional()
        }),
        response: { 200: z2.array(AnyObject) }
      }
    },
    async (request) => {
      const p = principal(request);
      const q = request.query;
      const from = (q.from ? new Date(q.from) : /* @__PURE__ */ new Date("1970-01-01T00:00:00Z")).toISOString();
      const to = (q.to ? new Date(q.to) : /* @__PURE__ */ new Date("2999-01-01T00:00:00Z")).toISOString();
      const groupExpr = q.groupBy === "day" ? sql`date_trunc('day', created_at)::text` : q.groupBy === "agent" ? sql`coalesce(run_id, 'none')` : sql`model`;
      const result = q.projectId ? await db.execute(
        sql`SELECT ${groupExpr} AS bucket, coalesce(sum(cost_cents), 0)::int AS cost_cents FROM llm_requests WHERE org_id = ${p.orgId} AND project_id = ${q.projectId} AND created_at >= ${from}::timestamptz AND created_at <= ${to}::timestamptz GROUP BY 1 ORDER BY 1`
      ) : await db.execute(
        sql`SELECT ${groupExpr} AS bucket, coalesce(sum(cost_cents), 0)::int AS cost_cents FROM llm_requests WHERE org_id = ${p.orgId} AND created_at >= ${from}::timestamptz AND created_at <= ${to}::timestamptz GROUP BY 1 ORDER BY 1`
      );
      return Array.from(result);
    }
  );
  app.get(
    "/v1/inbox",
    {
      config: { permission: "hitl:read" },
      schema: {
        querystring: z2.object({ state: z2.string().optional() }),
        response: { 200: z2.array(AnyObject) }
      }
    },
    async (request) => {
      const p = principal(request);
      const state = request.query.state;
      return db.select().from(proposals).where(
        state ? and(eq2(proposals.orgId, p.orgId), eq2(proposals.state, state)) : eq2(proposals.orgId, p.orgId)
      );
    }
  );
  app.get(
    "/v1/proposals/:proposalId",
    {
      config: { permission: "hitl:read" },
      schema: { params: IdParams, response: { 200: AnyObject } }
    },
    async (request) => {
      const p = principal(request);
      const { proposalId } = request.params;
      const proposal = (await db.select().from(proposals).where(and(eq2(proposals.orgId, p.orgId), eq2(proposals.id, proposalId))).limit(1))[0];
      const events = await db.select().from(proposalEvents).where(and(eq2(proposalEvents.orgId, p.orgId), eq2(proposalEvents.proposalId, proposalId))).orderBy(asc(proposalEvents.seq));
      return { ...proposal, events };
    }
  );
  app.post(
    "/v1/proposals",
    {
      config: { permission: "hitl:write", auditAction: "hitl.proposed" },
      schema: {
        body: z2.object({
          projectId: z2.string().optional(),
          runId: z2.string().optional(),
          actionTypeId: z2.string(),
          payload: AnyObject,
          contextMd: z2.string(),
          expiresAt: z2.string().optional()
        }),
        response: { 200: AnyObject }
      }
    },
    async (request) => {
      const p = principal(request);
      const body = request.body;
      const actionType = (await db.select().from(actionTypes).where(and(eq2(actionTypes.orgId, p.orgId), eq2(actionTypes.id, body.actionTypeId))).limit(1))[0];
      if (!actionType) throw notFound("Action type not found");
      const required = Array.isArray(actionType.payloadSchema.required) ? actionType.payloadSchema.required : [];
      for (const key of required)
        if (!(key in body.payload))
          throw new ApiError(400, "schema_validation_failed", `Missing payload field: ${key}`);
      const proposal = (await db.insert(proposals).values({
        id: newId("prop"),
        orgId: p.orgId,
        projectId: body.projectId,
        runId: body.runId,
        actionTypeId: body.actionTypeId,
        payload: body.payload,
        contextMd: body.contextMd,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : new Date(Date.now() + actionType.defaultTtlHours * 36e5)
      }).returning())[0];
      if (proposal)
        await db.insert(proposalEvents).values({
          orgId: p.orgId,
          proposalId: proposal.id,
          seq: 1,
          type: "open",
          actor: { type: p.type, id: p.id },
          data: {}
        });
      return proposal;
    }
  );
  app.post(
    "/v1/proposals/:proposalId/decide",
    {
      config: { permission: "hitl:decide", auditAction: "hitl.decided" },
      schema: {
        params: IdParams,
        body: z2.object({ decision: z2.enum(["approve", "reject"]), note: z2.string().optional() }),
        response: { 200: AnyObject }
      }
    },
    async (request) => {
      const p = principal(request);
      const { proposalId } = request.params;
      const body = request.body;
      const state = body.decision === "approve" ? "approved" : "rejected";
      const row = (await db.update(proposals).set({ state, decidedBy: p.id, decidedAt: /* @__PURE__ */ new Date() }).where(and(eq2(proposals.orgId, p.orgId), eq2(proposals.id, proposalId))).returning())[0];
      const current = await db.select().from(proposalEvents).where(and(eq2(proposalEvents.orgId, p.orgId), eq2(proposalEvents.proposalId, proposalId))).orderBy(desc(proposalEvents.seq)).limit(1);
      await db.insert(proposalEvents).values({
        orgId: p.orgId,
        proposalId,
        seq: (current[0]?.seq ?? 0) + 1,
        type: state,
        actor: { type: p.type, id: p.id },
        data: { note: body.note }
      });
      return row;
    }
  );
  app.get(
    "/v1/issues",
    {
      config: { permission: "issues:read" },
      schema: {
        querystring: z2.object({ state: z2.string().optional(), kind: z2.string().optional() }),
        response: { 200: z2.array(AnyObject) }
      }
    },
    async (request) => {
      const p = principal(request);
      const q = request.query;
      const clauses = [eq2(platformIssues.orgId, p.orgId)];
      if (q.state) clauses.push(eq2(platformIssues.state, q.state));
      if (q.kind) clauses.push(eq2(platformIssues.kind, q.kind));
      return db.select().from(platformIssues).where(and(...clauses));
    }
  );
  for (const action of ["ack", "resolve"]) {
    app.post(
      `/v1/issues/:issueId/${action}`,
      {
        config: {
          permission: "issues:write",
          auditAction: action === "ack" ? "issue.acked" : "issue.resolved"
        },
        schema: { params: IdParams, response: { 200: AnyObject } }
      },
      async (request) => {
        const p = principal(request);
        const { issueId } = request.params;
        return (await db.update(platformIssues).set({ state: action === "ack" ? "acked" : "resolved", updatedAt: /* @__PURE__ */ new Date() }).where(and(eq2(platformIssues.orgId, p.orgId), eq2(platformIssues.id, issueId))).returning())[0];
      }
    );
  }
  app.get(
    "/v1/audit",
    {
      config: { permission: "audit:read" },
      schema: {
        querystring: z2.object({
          from: z2.coerce.number().optional(),
          to: z2.coerce.number().optional(),
          actor: z2.string().optional(),
          action: z2.string().optional()
        }),
        response: { 200: z2.array(AnyObject) }
      }
    },
    async (request) => {
      const p = principal(request);
      const q = request.query;
      const clauses = [eq2(auditEvents.orgId, p.orgId)];
      if (q.from) clauses.push(gte(auditEvents.seq, q.from));
      if (q.to) clauses.push(lte(auditEvents.seq, q.to));
      if (q.action) clauses.push(eq2(auditEvents.action, q.action));
      return db.select().from(auditEvents).where(and(...clauses)).orderBy(asc(auditEvents.seq)).limit(200);
    }
  );
  app.get(
    "/v1/audit/verify",
    {
      config: { permission: "audit:read" },
      schema: {
        querystring: z2.object({ from: z2.string().optional(), to: z2.string().optional() }),
        response: { 200: z2.object({ ok: z2.boolean(), firstBreakSeq: z2.number().nullable() }) }
      }
    },
    async (request) => verifyAuditChain(db, principal(request).orgId)
  );
  app.get(
    "/v1/projects/:projectId/kb/space",
    {
      config: { permission: "kb:read" },
      schema: { params: IdParams, response: { 200: AnyObject } }
    },
    async (request) => {
      const p = principal(request);
      const { projectId } = request.params;
      return (await db.select().from(kbSpaces).where(and(eq2(kbSpaces.orgId, p.orgId), eq2(kbSpaces.projectId, projectId))).limit(1))[0] ?? null;
    }
  );
  app.put(
    "/v1/projects/:projectId/kb/space",
    {
      config: { permission: "kb:write", auditAction: "kb.updated" },
      schema: {
        params: IdParams,
        body: z2.object({
          charterMd: z2.string().default(""),
          activeMd: z2.string().default(""),
          config: AnyObject.default({})
        }),
        response: { 200: AnyObject }
      }
    },
    async (request) => {
      const p = principal(request);
      const { projectId } = request.params;
      const body = request.body;
      return (await db.insert(kbSpaces).values({ id: newId("kb"), orgId: p.orgId, projectId, ...body }).onConflictDoUpdate({
        target: kbSpaces.projectId,
        set: { ...body, updatedAt: /* @__PURE__ */ new Date() }
      }).returning())[0];
    }
  );
  app.get(
    "/v1/projects/:projectId/kb/entries",
    {
      config: { permission: "kb:read" },
      schema: {
        params: IdParams,
        querystring: z2.object({ type: z2.string().optional() }),
        response: { 200: z2.array(AnyObject) }
      }
    },
    async (request) => {
      const p = principal(request);
      const space = await spaceFor(p.orgId, request.params.projectId);
      if (!space) return [];
      const type = request.query.type;
      return db.select().from(kbEntries).where(
        type ? and(
          eq2(kbEntries.orgId, p.orgId),
          eq2(kbEntries.spaceId, space.id),
          eq2(kbEntries.type, type)
        ) : and(eq2(kbEntries.orgId, p.orgId), eq2(kbEntries.spaceId, space.id))
      );
    }
  );
  app.get(
    "/v1/kb/entries/:entryId",
    {
      config: { permission: "kb:read" },
      schema: { params: IdParams, response: { 200: AnyObject } }
    },
    async (request) => {
      const p = principal(request);
      return (await db.select().from(kbEntries).where(
        and(
          eq2(kbEntries.orgId, p.orgId),
          eq2(kbEntries.id, request.params.entryId)
        )
      ).limit(1))[0] ?? null;
    }
  );
  app.post(
    "/v1/projects/:projectId/kb/entries",
    {
      config: { permission: "kb:write", auditAction: "kb.updated" },
      schema: {
        params: IdParams,
        body: z2.object({
          type: z2.string(),
          slug: z2.string(),
          frontmatter: AnyObject.default({}),
          bodyMd: z2.string(),
          status: z2.string().optional(),
          links: z2.array(z2.string()).default([])
        }),
        response: { 200: AnyObject }
      }
    },
    async (request) => {
      const p = principal(request);
      const { projectId } = request.params;
      const body = request.body;
      const space = await spaceFor(p.orgId, projectId);
      if (!space) throw notFound("KB space not found");
      if (body.type !== "H" && body.links.length === 0)
        throw new ApiError(400, "dag_parent_required", "Non-root KB entries require a parent link");
      const max = (await db.select().from(kbEntries).where(
        and(
          eq2(kbEntries.orgId, p.orgId),
          eq2(kbEntries.spaceId, space.id),
          eq2(kbEntries.type, body.type)
        )
      ).orderBy(desc(kbEntries.number)).limit(1))[0]?.number ?? 0;
      const entry = (await db.insert(kbEntries).values({
        id: newId("kb"),
        orgId: p.orgId,
        spaceId: space.id,
        type: body.type,
        number: max + 1,
        slug: body.slug,
        frontmatter: body.frontmatter,
        bodyMd: body.bodyMd,
        status: body.status
      }).returning())[0];
      if (entry) {
        for (const link of body.links) {
          await db.insert(kbLinks).values([
            { orgId: p.orgId, spaceId: space.id, fromEntry: entry.id, toEntry: link },
            { orgId: p.orgId, spaceId: space.id, fromEntry: link, toEntry: entry.id }
          ]).onConflictDoNothing();
        }
      }
      return entry;
    }
  );
  app.patch(
    "/v1/kb/entries/:entryId",
    {
      config: { permission: "kb:write", auditAction: "kb.updated" },
      schema: { params: IdParams, body: AnyObject, response: { 200: AnyObject } }
    },
    async (request) => (await db.update(kbEntries).set({ ...request.body, updatedAt: /* @__PURE__ */ new Date() }).where(
      and(
        eq2(kbEntries.orgId, principal(request).orgId),
        eq2(kbEntries.id, request.params.entryId)
      )
    ).returning())[0]
  );
  app.post(
    "/v1/projects/:projectId/kb/validate",
    {
      config: { permission: "kb:write", auditAction: "kb.updated" },
      schema: {
        params: IdParams,
        response: { 200: z2.object({ ok: z2.boolean(), errors: z2.array(z2.string()) }) }
      }
    },
    async () => ({ ok: true, errors: [] })
  );
  async function spaceFor(orgId, projectId) {
    return (await db.select().from(kbSpaces).where(and(eq2(kbSpaces.orgId, orgId), eq2(kbSpaces.projectId, projectId))).limit(1))[0];
  }
  app.get(
    "/v1/projects/:projectId/tasks",
    {
      config: { permission: "tasks:read" },
      schema: { params: IdParams, response: { 200: z2.array(AnyObject) } }
    },
    async (request) => db.select().from(poTasks).where(
      and(
        eq2(poTasks.orgId, principal(request).orgId),
        eq2(poTasks.projectId, request.params.projectId)
      )
    )
  );
  app.post(
    "/v1/projects/:projectId/tasks",
    {
      config: { permission: "tasks:write", auditAction: "task.updated" },
      schema: {
        params: IdParams,
        body: z2.object({
          title: z2.string(),
          bodyMd: z2.string(),
          status: z2.string().default("draft"),
          kbEntryId: z2.string().optional(),
          wsjf: AnyObject.default({})
        }),
        response: { 200: AnyObject }
      }
    },
    async (request) => {
      const body = request.body;
      return (await db.insert(poTasks).values({
        id: newId("task"),
        orgId: principal(request).orgId,
        projectId: request.params.projectId,
        ...body
      }).returning())[0];
    }
  );
  app.patch(
    "/v1/projects/:projectId/tasks/:taskId",
    {
      config: { permission: "tasks:write", auditAction: "task.updated" },
      schema: {
        params: z2.object({ projectId: z2.string(), taskId: z2.string() }),
        body: AnyObject,
        response: { 200: AnyObject }
      }
    },
    async (request) => (await db.update(poTasks).set({ ...request.body, updatedAt: /* @__PURE__ */ new Date() }).where(
      and(
        eq2(poTasks.orgId, principal(request).orgId),
        eq2(poTasks.id, request.params.taskId)
      )
    ).returning())[0]
  );
  app.delete(
    "/v1/projects/:projectId/tasks/:taskId",
    {
      config: { permission: "tasks:write", auditAction: "task.updated" },
      schema: {
        params: z2.object({ projectId: z2.string(), taskId: z2.string() }),
        response: { 200: Ok }
      }
    },
    async (request) => {
      await db.delete(poTasks).where(
        and(
          eq2(poTasks.orgId, principal(request).orgId),
          eq2(poTasks.id, request.params.taskId)
        )
      );
      return { ok: true };
    }
  );
  app.post(
    "/v1/tasks/:taskId/transition",
    {
      config: { permission: "tasks:write", auditAction: "task.updated" },
      schema: {
        params: IdParams,
        body: z2.object({ status: z2.string() }),
        response: { 200: AnyObject }
      }
    },
    async (request) => (await db.update(poTasks).set({ status: request.body.status, updatedAt: /* @__PURE__ */ new Date() }).where(
      and(
        eq2(poTasks.orgId, principal(request).orgId),
        eq2(poTasks.id, request.params.taskId)
      )
    ).returning())[0]
  );
  registerCrud(app, "/v1/projects/:projectId/agents", "agents", agentDefs, "agent");
  registerCrud(app, "/v1/sandbox-profiles", "sandboxes", sandboxProfiles, "sbx");
}
async function streamRunEvents(reply, load) {
  reply.raw.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive"
  });
  const write = (event, data) => reply.raw.write(`event: ${event}
data: ${JSON.stringify(data)}

`);
  write("heartbeat", { ts: (/* @__PURE__ */ new Date()).toISOString() });
  const events = await load();
  for (const event of events) write("run_event", event);
  reply.raw.end();
}
function registerCrud(app, base, permissionResource, table, prefix) {
  app.get(
    base,
    {
      config: { permission: `${permissionResource}:read` },
      schema: { params: IdParams, response: { 200: z2.array(AnyObject) } }
    },
    async (request) => {
      const p = principal(request);
      const params = request.params;
      const clauses = [eq2(table.orgId, p.orgId)];
      if (params.projectId && table.projectId) clauses.push(eq2(table.projectId, params.projectId));
      return app.facilityDb.select().from(table).where(and(...clauses));
    }
  );
  app.post(
    base,
    {
      config: {
        permission: `${permissionResource}:write`,
        auditAction: `${permissionResource}.updated`
      },
      schema: { params: IdParams, body: AnyObject, response: { 200: AnyObject } }
    },
    async (request) => {
      const p = principal(request);
      const params = request.params;
      return (await app.facilityDb.insert(table).values({
        id: newId(prefix),
        orgId: p.orgId,
        projectId: params.projectId,
        ...request.body
      }).returning())[0];
    }
  );
  app.patch(
    `${base}/:id`,
    {
      config: {
        permission: `${permissionResource}:write`,
        auditAction: `${permissionResource}.updated`
      },
      schema: {
        params: z2.object({ projectId: z2.string().optional(), id: z2.string() }),
        body: AnyObject,
        response: { 200: AnyObject }
      }
    },
    async (request) => {
      const p = principal(request);
      const { id } = request.params;
      return (await app.facilityDb.update(table).set({ ...request.body, updatedAt: /* @__PURE__ */ new Date() }).where(and(eq2(table.orgId, p.orgId), eq2(table.id, id))).returning())[0];
    }
  );
  app.delete(
    `${base}/:id`,
    {
      config: {
        permission: `${permissionResource}:write`,
        auditAction: `${permissionResource}.updated`
      },
      schema: {
        params: z2.object({ projectId: z2.string().optional(), id: z2.string() }),
        response: { 200: Ok }
      }
    },
    async (request) => {
      const p = principal(request);
      const { id } = request.params;
      await app.facilityDb.delete(table).where(and(eq2(table.orgId, p.orgId), eq2(table.id, id)));
      return { ok: true };
    }
  );
}

// src/app.ts
var publicRoutes = /* @__PURE__ */ new Set([
  "GET /health",
  "POST /auth/dev-login",
  "GET /auth/login",
  "GET /auth/callback",
  "POST /auth/logout"
]);
var publicPrefixes = ["/docs"];
async function buildApp(config = readConfig()) {
  const app = Fastify({
    logger: { level: config.logLevel },
    genReqId: () => uuidv7()
  });
  const routeRecords = [];
  const { db, client } = createDb(config.databaseUrl);
  app.decorate("facilityDb", db);
  const boss = new PgBoss({ connectionString: config.databaseUrl });
  boss.on("error", (error) => app.log.error({ err: error }, "pg-boss producer error"));
  let bossStarted = false;
  app.decorate("enqueue", async (queue, data) => {
    if (!bossStarted) {
      await boss.start();
      await boss.createQueue(queue);
      bossStarted = true;
    }
    return boss.send(queue, data);
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.addHook("onRoute", (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const method of methods) {
      routeRecords.push({
        method,
        url: route.url,
        permission: route.config?.permission,
        public: route.config?.public
      });
    }
  });
  app.setErrorHandler((error, _request, reply) => {
    const err = error;
    if (error instanceof ApiError) {
      return sendError(reply, error);
    }
    const status = typeof err.statusCode === "number" ? err.statusCode : 500;
    return reply.status(status).send({
      error: { code: status === 400 ? "bad_request" : "internal_error", message: err.message }
    });
  });
  await app.register(cookie, { secret: config.workosCookiePassword ?? config.secretMasterKey });
  await app.register(cors, {
    origin: [config.publicUrl, config.webUrl].filter((value) => Boolean(value)),
    credentials: true
  });
  await app.register(rateLimit, { max: 200, timeWindow: "1 minute" });
  await app.register(swagger, {
    openapi: {
      info: { title: "Facility API", version: "0.3.0" }
    },
    transform: jsonSchemaTransform
  });
  app.decorateRequest("principal", void 0);
  app.decorateRequest(
    "audit",
    async function audit(action, target, payload = {}) {
      const principal2 = this.principal;
      if (!principal2) return;
      await insertAuditEvent(db, {
        orgId: principal2.orgId,
        actor: { type: principal2.type, id: principal2.id },
        action,
        target,
        payload,
        ip: this.ip,
        userAgent: this.headers["user-agent"]
      });
    }
  );
  app.addHook("preHandler", async (request) => {
    request.principal = await resolvePrincipal(request, db, config);
    const permission = request.routeOptions.config?.permission;
    const isPublic = request.routeOptions.config?.public === true;
    if (!permission && isPublic) return;
    if (!permission) return;
    if (!request.principal) {
      throw new ApiError(401, "unauthorized", "Authentication required");
    }
    const projectId = request.params?.projectId;
    if (projectId) {
      if (request.principal.projectId && request.principal.projectId !== projectId) {
        throw new ApiError(404, "not_found", "Project not found");
      }
      const project = (await db.select({ id: projects2.id }).from(projects2).where(and2(eq3(projects2.id, projectId), eq3(projects2.orgId, request.principal.orgId))).limit(1))[0];
      if (!project) {
        throw new ApiError(404, "not_found", "Project not found");
      }
    }
    if (!can(request.principal.permissions, permission)) {
      throw new ApiError(403, "forbidden", "Permission denied", { needed: permission });
    }
  });
  app.addHook("onResponse", async (request, reply) => {
    const permission = request.routeOptions.config?.permission;
    const action = request.routeOptions.config?.auditAction;
    if (!permission || request.method === "GET" || reply.statusCode < 200 || reply.statusCode >= 300 || !action) {
      return;
    }
    const params = request.params;
    await request.audit(action, {
      type: params.projectId ? "project" : "route",
      id: params.projectId ?? request.url
    });
  });
  app.get(
    "/health",
    {
      config: { public: true },
      schema: {
        response: {
          200: z3.object({ ok: z3.boolean(), version: z3.string(), db: z3.enum(["ok", "down"]) })
        }
      }
    },
    async () => {
      try {
        await db.execute("select 1");
        return { ok: true, version: "0.3.0", db: "ok" };
      } catch {
        return { ok: false, version: "0.3.0", db: "down" };
      }
    }
  );
  await registerAuthRoutes(app, config);
  await registerV1Routes(app, config);
  await app.register(swaggerUi, { routePrefix: "/docs" });
  app.addHook("onReady", async () => {
    for (const route of routeRecords) {
      if (route.method === "OPTIONS" && route.url === "*") continue;
      if (publicPrefixes.some((prefix) => route.url.startsWith(prefix))) continue;
      if (route.public || publicRoutes.has(`${route.method} ${route.url}`)) continue;
      if (!route.permission) {
        throw new Error(
          `Protected route missing permission declaration: ${route.method} ${route.url}`
        );
      }
    }
  });
  app.addHook("onClose", async () => {
    if (bossStarted) await boss.stop({ close: true });
    await client.end();
  });
  return app;
}
async function resolvePrincipal(request, db, config) {
  const auth = request.headers.authorization;
  if (auth?.startsWith("Bearer fak_")) {
    const secret = auth.slice("Bearer ".length);
    const rows = await db.select({
      key: apiKeys2,
      role: rolesTable
    }).from(apiKeys2).innerJoin(rolesTable, eq3(apiKeys2.roleId, rolesTable.id)).where(and2(eq3(apiKeys2.prefix, keyLookup(secret)), isNull2(apiKeys2.revokedAt))).limit(2);
    for (const row of rows) {
      if (await verifyKey(secret, row.key.hash)) {
        await db.update(apiKeys2).set({ lastUsedAt: /* @__PURE__ */ new Date() }).where(eq3(apiKeys2.id, row.key.id));
        return {
          type: "key",
          id: row.key.id,
          orgId: row.key.orgId,
          projectId: row.key.projectId,
          permissions: row.role.permissions
        };
      }
    }
    throw new ApiError(401, "unauthorized", "Invalid API key");
  }
  const rawCookie = request.cookies.facility_session;
  if (!rawCookie) {
    return void 0;
  }
  const unsigned = request.unsignCookie(rawCookie);
  const sealedSession = unsigned.valid ? unsigned.value : rawCookie;
  if (!sealedSession) return void 0;
  try {
    const session = z3.object({ userId: z3.string(), orgId: z3.string(), exp: z3.number() }).parse(JSON.parse(await open(sealedSession, config.secretMasterKey)));
    if (session.exp < Date.now()) {
      throw new ApiError(401, "unauthorized", "Session expired");
    }
    const member = (await db.select({ role: rolesTable }).from(orgMembers2).innerJoin(rolesTable, eq3(orgMembers2.roleId, rolesTable.id)).where(and2(eq3(orgMembers2.userId, session.userId), eq3(orgMembers2.orgId, session.orgId))).limit(1))[0];
    if (!member) return void 0;
    return {
      type: "user",
      id: session.userId,
      userId: session.userId,
      orgId: session.orgId,
      permissions: member.role.permissions
    };
  } catch {
    return void 0;
  }
}
async function mintSessionCookie(config, userId, orgId) {
  return seal2(
    JSON.stringify({ userId, orgId, exp: Date.now() + 7 * 24 * 60 * 60 * 1e3 }),
    config.secretMasterKey
  );
}
async function ensureDevUser(db, email) {
  const org = (await db.select().from(orgs3).where(eq3(orgs3.slug, "the-agile-monkeys")).limit(1))[0];
  if (!org) throw new ApiError(500, "seed_required", "Dev org is not seeded");
  const role = (await db.select().from(rolesTable).where(
    and2(
      eq3(rolesTable.name, "owner"),
      or2(isNull2(rolesTable.orgId), eq3(rolesTable.orgId, org.id))
    )
  ).limit(1))[0];
  if (!role) throw new ApiError(500, "seed_required", "Bundled owner role is not seeded");
  const existing = (await db.select().from(users2).where(eq3(users2.email, email)).limit(1))[0];
  const userId = existing?.id ?? newId2("user");
  if (!existing) {
    await db.insert(users2).values({ id: userId, email, name: email, status: "active" });
  }
  await db.insert(orgMembers2).values({ id: newId2("user"), orgId: org.id, userId, roleId: role.id }).onConflictDoUpdate({
    target: [orgMembers2.orgId, orgMembers2.userId],
    set: { roleId: role.id, updatedAt: /* @__PURE__ */ new Date() }
  });
  return { userId, orgId: org.id };
}

export {
  buildApp,
  mintSessionCookie,
  ensureDevUser
};
