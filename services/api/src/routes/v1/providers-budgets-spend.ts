import { generateApiKey, newId, seal } from "@facility/core";
import { budgets, providerCredentials, virtualKeys } from "@facility/db";
import { and, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { notFound } from "../../errors.js";
import type { Principal } from "../../types.js";
import {
  AnyObject,
  assertBareRowProjectScope,
  assertProjectScope,
  BudgetSchema,
  definedFields,
  IdParams,
  Ok,
  ProviderPublicSchema,
  principal,
  publicRow,
  SpendRowSchema,
  assertProjectInOrg as sharedAssertProjectInOrg,
  type V1RouteContext,
  validateApiProviderBaseUrl,
} from "./shared.js";

export async function registerProvidersBudgetsSpendRoutes(
  app: FastifyInstance,
  context: V1RouteContext,
) {
  const { db, config } = context;
  const assertProjectInOrg = (
    p: Principal,
    projectId: string | null | undefined,
    statusCode?: number,
  ) => sharedAssertProjectInOrg(db, p, projectId, statusCode);
  app.get(
    "/v1/providers",
    {
      config: { permission: "providers:read", orgAdmin: true },
      schema: { response: { 200: z.array(ProviderPublicSchema) } },
    },
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
      config: { permission: "providers:write", auditAction: "provider.created", orgAdmin: true },
      schema: {
        body: z.object({
          provider: z.string(),
          name: z.string(),
          baseUrl: z.string().optional(),
          secret: z.string(),
        }),
        response: { 200: ProviderPublicSchema.nullable() },
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
      const baseUrl = body.baseUrl
        ? await validateApiProviderBaseUrl(body.baseUrl, config.facilityInsecureDev)
        : undefined;
      const sealedSecret = await seal(body.secret, config.secretMasterKey);
      const row = (
        await db
          .insert(providerCredentials)
          .values({
            id: newId("key"),
            orgId: p.orgId,
            provider: body.provider,
            name: body.name,
            baseUrl,
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
      config: { permission: "providers:write", auditAction: "provider.deleted", orgAdmin: true },
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
      assertProjectScope(p, projectId);
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
      assertProjectScope(p, projectId);
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
      const { projectId, keyId } = request.params as { projectId: string; keyId: string };
      assertProjectScope(p, projectId);
      await db
        .update(virtualKeys)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(virtualKeys.orgId, p.orgId),
            eq(virtualKeys.projectId, projectId),
            eq(virtualKeys.id, keyId),
          ),
        );
      return { ok: true };
    },
  );

  app.get(
    "/v1/budgets",
    {
      config: { permission: "budgets:read" },
      schema: { response: { 200: z.array(BudgetSchema) } },
    },
    async (request) => {
      const p = principal(request);
      const clauses = [eq(budgets.orgId, p.orgId)];
      if (p.projectId) clauses.push(eq(budgets.projectId, p.projectId));
      return db
        .select()
        .from(budgets)
        .where(and(...clauses));
    },
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
        response: { 200: BudgetSchema },
      },
    },
    async (request) => {
      const p = principal(request);
      const body = request.body as {
        scope: string;
        projectId?: string;
        agentDefId?: string;
        period: string;
        limitCents: number;
        mode: string;
        enabled: boolean;
      };
      await assertProjectInOrg(p, body.projectId);
      const projectId = p.projectId ?? body.projectId;
      return (
        await db
          .insert(budgets)
          .values({
            id: newId("bud"),
            orgId: p.orgId,
            scope: body.scope,
            projectId,
            agentDefId: body.agentDefId,
            period: body.period,
            limitCents: body.limitCents,
            mode: body.mode,
            enabled: body.enabled,
          })
          .returning()
      )[0];
    },
  );

  async function loadBudget(p: Principal, budgetId: string) {
    const budget = (
      await db
        .select()
        .from(budgets)
        .where(and(eq(budgets.orgId, p.orgId), eq(budgets.id, budgetId)))
        .limit(1)
    )[0];
    if (!budget) throw notFound("Budget not found");
    assertBareRowProjectScope(p, budget.projectId, "Budget not found");
    return budget;
  }

  app.get(
    "/v1/budgets/:budgetId",
    {
      config: { permission: "budgets:read" },
      schema: { params: z.object({ budgetId: z.string() }), response: { 200: BudgetSchema } },
    },
    async (request) => {
      const p = principal(request);
      return loadBudget(p, (request.params as { budgetId: string }).budgetId);
    },
  );

  app.patch(
    "/v1/budgets/:budgetId",
    {
      config: { permission: "budgets:write", auditAction: "budget.breached" },
      schema: {
        params: z.object({ budgetId: z.string() }),
        body: z.object({
          scope: z.string().optional(),
          projectId: z.string().optional(),
          agentDefId: z.string().optional(),
          period: z.string().optional(),
          limitCents: z.number().int().optional(),
          mode: z.string().optional(),
          enabled: z.boolean().optional(),
        }),
        response: { 200: BudgetSchema },
      },
    },
    async (request) => {
      const p = principal(request);
      const { budgetId } = request.params as { budgetId: string };
      const body = request.body as {
        scope?: string;
        projectId?: string;
        agentDefId?: string;
        period?: string;
        limitCents?: number;
        mode?: string;
        enabled?: boolean;
      };
      await loadBudget(p, budgetId);
      await assertProjectInOrg(p, body.projectId);
      return (
        await db
          .update(budgets)
          .set(
            definedFields({
              scope: body.scope,
              projectId: p.projectId ?? body.projectId,
              agentDefId: body.agentDefId,
              period: body.period,
              limitCents: body.limitCents,
              mode: body.mode,
              enabled: body.enabled,
              updatedAt: new Date(),
            }),
          )
          .where(and(eq(budgets.orgId, p.orgId), eq(budgets.id, budgetId)))
          .returning()
      )[0];
    },
  );
  app.delete(
    "/v1/budgets/:budgetId",
    {
      config: { permission: "budgets:write", auditAction: "budget.breached" },
      schema: { params: z.object({ budgetId: z.string() }), response: { 200: Ok } },
    },
    async (request) => {
      const p = principal(request);
      const { budgetId } = request.params as { budgetId: string };
      await loadBudget(p, budgetId);
      await db.delete(budgets).where(and(eq(budgets.orgId, p.orgId), eq(budgets.id, budgetId)));
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
          groupBy: z.enum(["model", "agent", "task", "day"]).optional(),
        }),
        response: { 200: z.array(SpendRowSchema) },
      },
    },
    async (request) => {
      const p = principal(request);
      const q = request.query as {
        projectId?: string;
        from?: string;
        to?: string;
        groupBy?: "model" | "agent" | "task" | "day";
      };
      const toDate = q.to ? new Date(q.to) : new Date();
      const fromDate = q.from ? new Date(q.from) : new Date(toDate.getTime() - 30 * 86_400_000);
      const from = fromDate.toISOString();
      const to = toDate.toISOString();
      await assertProjectInOrg(p, q.projectId);
      const projectId = p.projectId ?? q.projectId;
      const groupExpr =
        q.groupBy === "day"
          ? sql`date_trunc('day', created_at)::text`
          : q.groupBy === "agent"
            ? sql`coalesce(agent_def_id, 'none')`
            : q.groupBy === "task"
              ? sql`coalesce(task_id, 'none')`
              : sql`model`;
      const result = projectId
        ? await db.execute(
            sql`SELECT ${groupExpr} AS bucket, floor(coalesce(sum(cost_cents), 0) + 0.5)::int AS cost_cents FROM llm_requests WHERE org_id = ${p.orgId} AND project_id = ${projectId} AND created_at >= ${from}::timestamptz AND created_at <= ${to}::timestamptz GROUP BY 1 ORDER BY 1`,
          )
        : await db.execute(
            sql`SELECT ${groupExpr} AS bucket, floor(coalesce(sum(cost_cents), 0) + 0.5)::int AS cost_cents FROM llm_requests WHERE org_id = ${p.orgId} AND created_at >= ${from}::timestamptz AND created_at <= ${to}::timestamptz GROUP BY 1 ORDER BY 1`,
          );
      return Array.from(result as Iterable<Record<string, unknown>>);
    },
  );
}
