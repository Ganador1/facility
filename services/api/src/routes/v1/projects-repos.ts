import { newId } from "@facility/core";
import { agentDefs, projects, registryItems, repos, sandboxProfiles, withOrg } from "@facility/db";
import { and, asc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ApiError, notFound } from "../../errors.js";
import { projectHealth } from "../../watchtower/health.js";
import {
  AnyObject,
  assertProjectScope,
  definedFields,
  IdParams,
  Ok,
  principal,
  type V1RouteContext,
} from "./shared.js";

export async function registerProjectsReposRoutes(app: FastifyInstance, context: V1RouteContext) {
  const { db } = context;
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
      const clauses = [eq(projects.orgId, p.orgId)];
      if (query.status) clauses.push(eq(projects.status, query.status));
      if (p.projectId) clauses.push(eq(projects.id, p.projectId));
      return db
        .select()
        .from(projects)
        .where(and(...clauses));
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

  app.get(
    "/v1/projects/:projectId/health",
    {
      config: { permission: "projects:read" },
      schema: {
        params: IdParams,
        response: {
          200: z.object({
            status: z.enum(["ok", "warn", "red"]),
            signals: z.array(AnyObject),
          }),
        },
      },
    },
    async (request) => {
      const p = principal(request);
      const { projectId } = request.params as { projectId: string };
      return projectHealth(db, p.orgId, projectId);
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
      assertProjectScope(p, projectId);
      return (
        await db
          .update(projects)
          .set(
            definedFields({
              name: (request.body as { name?: string }).name,
              description: (request.body as { description?: string }).description,
              status: (request.body as { status?: string }).status,
              settings: (request.body as { settings?: Record<string, unknown> }).settings,
              updatedAt: new Date(),
            }),
          )
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
          .values({
            id: newId("repo"),
            orgId: p.orgId,
            projectId,
            owner: body.owner,
            name: body.name,
            defaultBranch: body.defaultBranch,
          })
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
        .where(eq(sandboxProfiles.orgId, orgId))
        .orderBy(asc(sandboxProfiles.createdAt))
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
          enabled: true,
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
          enabled: true,
        })
        .onConflictDoNothing();
    }
  }
}
