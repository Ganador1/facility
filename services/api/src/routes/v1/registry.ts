import { newId } from "@facility/core";
import { registryItems, registryVersions } from "@facility/db";
import { and, asc, desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ApiError, notFound } from "../../errors.js";
import type { Principal } from "../../types.js";
import {
  assertBareRowProjectScope,
  IdParams,
  principal,
  RegistryItemSchema,
  RegistryItemWithVersionsSchema,
  RegistryVersionSchema,
  assertProjectInOrg as sharedAssertProjectInOrg,
  type V1RouteContext,
} from "./shared.js";

export async function registerRegistryRoutes(app: FastifyInstance, context: V1RouteContext) {
  const { db } = context;
  const assertProjectInOrg = (
    p: Principal,
    projectId: string | null | undefined,
    statusCode?: number,
  ) => sharedAssertProjectInOrg(db, p, projectId, statusCode);
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
        response: { 200: z.array(RegistryItemSchema) },
      },
    },
    async (request) => {
      const p = principal(request);
      const q = request.query as { kind?: string; scope?: string; projectId?: string };
      const clauses = [eq(registryItems.orgId, p.orgId)];
      if (q.kind) clauses.push(eq(registryItems.kind, q.kind));
      if (q.scope) clauses.push(eq(registryItems.scope, q.scope));
      if (q.projectId) {
        await assertProjectInOrg(p, q.projectId);
        clauses.push(eq(registryItems.projectId, q.projectId));
      } else if (p.projectId) {
        clauses.push(eq(registryItems.projectId, p.projectId));
      }
      return db
        .select()
        .from(registryItems)
        .where(and(...clauses));
    },
  );

  async function loadRegistryItem(p: Principal, itemId: string) {
    const item = (
      await db
        .select()
        .from(registryItems)
        .where(and(eq(registryItems.orgId, p.orgId), eq(registryItems.id, itemId)))
        .limit(1)
    )[0];
    if (!item) throw notFound("Registry item not found");
    assertBareRowProjectScope(p, item.projectId, "Registry item not found");
    return item;
  }

  async function loadRegistryVersion(p: Principal, versionId: string) {
    const row = (
      await db
        .select({ version: registryVersions, item: registryItems })
        .from(registryVersions)
        .innerJoin(
          registryItems,
          and(
            eq(registryItems.orgId, registryVersions.orgId),
            eq(registryItems.id, registryVersions.itemId),
          ),
        )
        .where(and(eq(registryVersions.orgId, p.orgId), eq(registryVersions.id, versionId)))
        .limit(1)
    )[0];
    if (!row) throw notFound("Registry version not found");
    assertBareRowProjectScope(p, row.item.projectId, "Registry version not found");
    return row.version;
  }

  app.get(
    "/v1/registry/items/:itemId",
    {
      config: { permission: "registry:read" },
      schema: { params: IdParams, response: { 200: RegistryItemWithVersionsSchema } },
    },
    async (request) => {
      const p = principal(request);
      const { itemId } = request.params as { itemId: string };
      const item = await loadRegistryItem(p, itemId);
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
        response: { 200: RegistryItemWithVersionsSchema },
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
      await assertProjectInOrg(p, body.projectId);
      const projectId = p.projectId ?? body.projectId;
      const item = (
        await db
          .insert(registryItems)
          .values({
            id: newId("item"),
            orgId: p.orgId,
            scope: body.scope,
            projectId,
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
        response: { 200: RegistryVersionSchema },
      },
    },
    async (request) => {
      const p = principal(request);
      const { itemId } = request.params as { itemId: string };
      await loadRegistryItem(p, itemId);
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
      schema: { params: IdParams, response: { 200: RegistryVersionSchema } },
    },
    async (request) => {
      const p = principal(request);
      const { versionId } = request.params as { versionId: string };
      await loadRegistryVersion(p, versionId);
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
      schema: { params: IdParams, response: { 200: RegistryVersionSchema } },
    },
    async (request) => {
      const p = principal(request);
      const { versionId } = request.params as { versionId: string };
      await loadRegistryVersion(p, versionId);
      return (
        await db
          .update(registryVersions)
          .set({ status: "deprecated", updatedAt: new Date() })
          .where(and(eq(registryVersions.orgId, p.orgId), eq(registryVersions.id, versionId)))
          .returning()
      )[0];
    },
  );
}
