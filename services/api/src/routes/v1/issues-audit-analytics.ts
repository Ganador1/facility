import { auditEvents, llmRequests, platformIssues, verifyAuditChain } from "@facility/db";
import { and, desc, eq, gte, lt, lte, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { readEnvelopeObject } from "../../envelopes.js";
import { notFound } from "../../errors.js";
import { analyticsOverview, queryAnalytics } from "../../watchtower/analytics.js";
import {
  AnyObject,
  AuditEventSchema,
  assertBareRowProjectScope,
  assertProjectScope,
  IdParams,
  LlmRequestSchema,
  principal,
  type V1RouteContext,
} from "./shared.js";

export async function registerAnalyticsRoutes(app: FastifyInstance, context: V1RouteContext) {
  const { db } = context;
  app.get(
    "/v1/analytics",
    {
      config: { permission: "analytics:read" },
      schema: {
        querystring: z.object({
          projectId: z.string().optional(),
          from: z.string().optional(),
          to: z.string().optional(),
          groupBy: z.enum(["day", "agent", "model"]).default("day"),
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
        groupBy: "day" | "agent" | "model";
      };
      assertProjectScope(p, q.projectId);
      return queryAnalytics(db, p.orgId, { ...q, projectId: p.projectId ?? q.projectId });
    },
  );

  app.get(
    "/v1/analytics/overview",
    {
      config: { permission: "analytics:read" },
      schema: { response: { 200: AnyObject } },
    },
    async (request) => {
      const p = principal(request);
      return analyticsOverview(db, p.orgId, p.projectId ?? undefined);
    },
  );
}

export async function registerIssuesAuditRoutes(app: FastifyInstance, context: V1RouteContext) {
  const { db } = context;
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
      if (p.projectId) clauses.push(eq(platformIssues.projectId, p.projectId));
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
        const issue = (
          await db
            .select()
            .from(platformIssues)
            .where(and(eq(platformIssues.orgId, p.orgId), eq(platformIssues.id, issueId)))
            .limit(1)
        )[0];
        if (!issue) throw notFound("Issue not found");
        assertBareRowProjectScope(p, issue.projectId, "Issue not found");
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
          limit: z.coerce.number().int().min(1).max(500).default(200),
          cursor: z.coerce.number().optional(),
        }),
        response: {
          200: z.object({ items: z.array(AuditEventSchema), nextCursor: z.number().nullable() }),
        },
      },
    },
    async (request) => {
      const p = principal(request);
      const q = request.query as {
        from?: number;
        to?: number;
        actor?: string;
        action?: string;
        limit?: number;
        cursor?: number;
      };
      const limit = Math.min(Math.max(Number(q.limit ?? 200), 1), 500);
      const clauses = [eq(auditEvents.orgId, p.orgId)];
      if (p.projectId) clauses.push(eq(auditEvents.projectId, p.projectId));
      if (q.from) clauses.push(gte(auditEvents.seq, q.from));
      if (q.to) clauses.push(lte(auditEvents.seq, q.to));
      if (q.cursor) clauses.push(lt(auditEvents.seq, q.cursor));
      if (q.action) clauses.push(eq(auditEvents.action, q.action));
      if (q.actor) {
        const [actorType, actorId] = q.actor.includes(":") ? q.actor.split(":", 2) : [];
        if (actorType && actorId) {
          clauses.push(
            sql`${auditEvents.actor}->>'type' = ${actorType} AND ${auditEvents.actor}->>'id' = ${actorId}`,
          );
        } else {
          clauses.push(sql`${auditEvents.actor}->>'id' = ${q.actor}`);
        }
      }
      const rows = await db
        .select()
        .from(auditEvents)
        .where(and(...clauses))
        .orderBy(desc(auditEvents.seq))
        .limit(limit + 1);
      const items = rows.slice(0, limit);
      return {
        items,
        nextCursor: rows.length > limit ? (items.at(-1)?.seq ?? null) : null,
      };
    },
  );

  app.get(
    "/v1/llm-requests",
    {
      config: { permission: "spend:read" },
      schema: {
        querystring: z.object({
          projectId: z.string().optional(),
          from: z.string().optional(),
          to: z.string().optional(),
          limit: z.coerce.number().int().min(1).max(500).default(100),
          cursor: z.string().optional(),
        }),
        response: {
          200: z.object({ items: z.array(LlmRequestSchema), nextCursor: z.string().nullable() }),
        },
      },
    },
    async (request) => {
      const p = principal(request);
      const q = request.query as {
        projectId?: string;
        from?: string;
        to?: string;
        limit?: number;
        cursor?: string;
      };
      assertProjectScope(p, q.projectId);
      const projectId = p.projectId ?? q.projectId;
      const limit = Math.min(Math.max(Number(q.limit ?? 100), 1), 500);
      const clauses = [eq(llmRequests.orgId, p.orgId)];
      if (projectId) clauses.push(eq(llmRequests.projectId, projectId));
      if (q.from) clauses.push(gte(llmRequests.createdAt, new Date(q.from)));
      if (q.to) clauses.push(lte(llmRequests.createdAt, new Date(q.to)));
      if (q.cursor) clauses.push(lt(llmRequests.createdAt, new Date(q.cursor)));
      const rows = await db
        .select()
        .from(llmRequests)
        .where(and(...clauses))
        .orderBy(desc(llmRequests.createdAt))
        .limit(limit + 1);
      const items = rows.slice(0, limit);
      return {
        items,
        nextCursor: rows.length > limit ? (items.at(-1)?.createdAt?.toISOString() ?? null) : null,
      };
    },
  );

  app.get(
    "/v1/llm-requests/:requestId/envelope",
    {
      config: { permission: ["spend:read", "audit:read"] },
      schema: {
        params: z.object({ requestId: z.string() }),
        response: { 200: z.object({ llmRequest: LlmRequestSchema, envelope: z.unknown() }) },
      },
    },
    async (request) => {
      const p = principal(request);
      const { requestId } = request.params as { requestId: string };
      const row = (
        await db
          .select()
          .from(llmRequests)
          .where(and(eq(llmRequests.orgId, p.orgId), eq(llmRequests.id, requestId)))
          .limit(1)
      )[0];
      if (!row) throw notFound("LLM request not found");
      assertBareRowProjectScope(p, row.projectId, "LLM request not found");
      return {
        llmRequest: row,
        envelope: await readEnvelopeObject(context.config, row.responseUri ?? row.requestUri),
      };
    },
  );

  app.get(
    "/v1/audit/verify",
    {
      config: { permission: "audit:read" },
      schema: {
        querystring: z.object({}),
        response: { 200: z.object({ ok: z.boolean(), firstBreakSeq: z.number().nullable() }) },
      },
    },
    async (request) => verifyAuditChain(db, principal(request).orgId),
  );
}

export async function registerIssuesAuditAnalyticsRoutes(
  app: FastifyInstance,
  context: V1RouteContext,
) {
  await registerAnalyticsRoutes(app, context);
  await registerIssuesAuditRoutes(app, context);
}
