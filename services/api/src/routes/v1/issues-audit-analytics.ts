import { auditEvents, platformIssues, verifyAuditChain } from "@facility/db";
import { and, asc, eq, gte, lte } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { notFound } from "../../errors.js";
import { analyticsOverview, queryAnalytics } from "../../watchtower/analytics.js";
import {
  AnyObject,
  assertProjectScope,
  IdParams,
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
        assertProjectScope(p, issue.projectId);
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
}

export async function registerIssuesAuditAnalyticsRoutes(
  app: FastifyInstance,
  context: V1RouteContext,
) {
  await registerAnalyticsRoutes(app, context);
  await registerIssuesAuditRoutes(app, context);
}
