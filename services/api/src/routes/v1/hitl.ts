import { newId } from "@facility/core";
import { actionTypes, platformIssues, proposalEvents, proposals } from "@facility/db";
import { and, asc, desc, eq, gt, isNull, or } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ApiError, notFound } from "../../errors.js";
import { executeApprovedProposal } from "../../executors.js";
import type { Principal } from "../../types.js";
import {
  AnyObject,
  assertProjectScope,
  IdParams,
  principal,
  assertProjectInOrg as sharedAssertProjectInOrg,
  type V1RouteContext,
} from "./shared.js";

export async function registerHitlRoutes(app: FastifyInstance, context: V1RouteContext) {
  const { db, config } = context;
  const assertProjectInOrg = (
    p: Principal,
    projectId: string | null | undefined,
    statusCode?: number,
  ) => sharedAssertProjectInOrg(db, p, projectId, statusCode);
  app.get(
    "/v1/inbox",
    {
      config: { permission: "hitl:read" },
      schema: {
        querystring: z.object({ state: z.string().optional() }),
        response: {
          200: z.object({
            items: z.array(AnyObject),
            proposals: z.array(AnyObject),
            issues: z.array(AnyObject),
          }),
        },
      },
    },
    async (request) => {
      const p = principal(request);
      const state = (request.query as { state?: string }).state;
      const proposalClauses = [eq(proposals.orgId, p.orgId)];
      if (state) proposalClauses.push(eq(proposals.state, state));
      if (p.projectId) proposalClauses.push(eq(proposals.projectId, p.projectId));
      const proposalRows = await db
        .select()
        .from(proposals)
        .where(and(...proposalClauses));
      const issueClauses = [
        eq(platformIssues.orgId, p.orgId),
        eq(platformIssues.severity, "error"),
        state
          ? eq(platformIssues.state, state)
          : or(eq(platformIssues.state, "open"), eq(platformIssues.state, "acked")),
      ];
      if (p.projectId) issueClauses.push(eq(platformIssues.projectId, p.projectId));
      const issueRows = await db
        .select()
        .from(platformIssues)
        .where(and(...issueClauses));
      return { items: proposalRows, proposals: proposalRows, issues: issueRows };
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
      if (!proposal) throw notFound("Proposal not found");
      assertProjectScope(p, proposal.projectId);
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
      await assertProjectInOrg(p, body.projectId);
      const projectId = p.projectId ?? body.projectId;
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
            projectId,
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
      const row = await db.transaction(async (tx) => {
        const updated = (
          await tx
            .update(proposals)
            .set({ state, decidedBy: p.id, decidedAt: new Date() })
            .where(
              and(
                eq(proposals.orgId, p.orgId),
                eq(proposals.id, proposalId),
                eq(proposals.state, "open"),
                or(isNull(proposals.expiresAt), gt(proposals.expiresAt, new Date())),
              ),
            )
            .returning()
        )[0];
        if (!updated) throw new ApiError(409, "not_open", "Proposal is not open");
        assertProjectScope(p, updated.projectId);
        const current = await tx
          .select()
          .from(proposalEvents)
          .where(and(eq(proposalEvents.orgId, p.orgId), eq(proposalEvents.proposalId, proposalId)))
          .orderBy(desc(proposalEvents.seq))
          .limit(1);
        await tx.insert(proposalEvents).values({
          orgId: p.orgId,
          proposalId,
          seq: (current[0]?.seq ?? 0) + 1,
          type: state,
          actor: { type: p.type, id: p.id },
          data: { note: body.note },
        });
        return updated;
      });
      if (row && state === "approved") {
        await executeApprovedProposal(db, row, { type: p.type, id: p.id }, { config });
        return (
          await db
            .select()
            .from(proposals)
            .where(and(eq(proposals.orgId, p.orgId), eq(proposals.id, proposalId)))
            .limit(1)
        )[0];
      }
      return row;
    },
  );

  app.post(
    "/v1/proposals/:proposalId/execute",
    {
      config: { permission: "hitl:decide", auditAction: "hitl.executed" },
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
      if (!proposal) throw notFound("Proposal not found");
      assertProjectScope(p, proposal.projectId);
      if (proposal.state !== "execution_failed" && proposal.state !== "approved") {
        throw new ApiError(409, "not_executable", "Proposal is not pending execution");
      }
      await executeApprovedProposal(db, proposal, { type: p.type, id: p.id }, { config });
      return (
        await db
          .select()
          .from(proposals)
          .where(and(eq(proposals.orgId, p.orgId), eq(proposals.id, proposalId)))
          .limit(1)
      )[0];
    },
  );
}
