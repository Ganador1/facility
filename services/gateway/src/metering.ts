import { costCents } from "@facility/core";
import type { FacilityDb } from "@facility/db";
import { llmRequests, virtualKeys } from "@facility/db";
import { eq } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import { addBudgetSpend, reconcileBudgetReservations } from "./budgets.js";
import type { EnvelopeStore, RequestRecord } from "./types.js";

export function enqueueMetering(
  db: FacilityDb,
  store: EnvelopeStore,
  logger: FastifyBaseLogger,
  record: RequestRecord,
  now: Date,
) {
  const run = () => writeMetering(db, store, record, now);
  setImmediate(() => {
    run().catch((error) => {
      logger.warn({ err: error, requestId: record.requestId }, "gateway metering write failed");
      setTimeout(() => {
        run().catch((retryError) =>
          logger.error(
            { err: retryError, requestId: record.requestId },
            "gateway metering retry failed",
          ),
        );
      }, 10);
    });
  });
}

export async function writeMetering(
  db: FacilityDb,
  store: EnvelopeStore,
  record: RequestRecord,
  now: Date,
) {
  const computedCost = costCents({
    model: record.model,
    inputTokens: record.usage.inputTokens,
    outputTokens: record.usage.outputTokens,
    cacheReadTokens: record.usage.cacheReadTokens,
    cacheWriteTokens: record.usage.cacheWriteTokens,
  });
  const cost = record.priced ? computedCost : 0;
  let envelopeUri: string | null = null;
  try {
    envelopeUri = await store.putEnvelope({
      orgId: record.key.orgId,
      requestId: record.requestId,
      now,
      payload: {
        request: record.requestBody,
        response: record.responseBody,
        meta: {
          request_id: record.requestId,
          provider: record.provider,
          model: record.model,
          status: record.status,
          status_code: record.statusCode,
          latency_ms: Date.now() - record.startedAt,
        },
      },
    });
  } catch {
    envelopeUri = null;
  }

  await db.insert(llmRequests).values({
    id: record.requestId,
    orgId: record.key.orgId,
    projectId: record.key.projectId,
    runId: record.key.runId,
    taskId: record.key.taskId,
    agentDefId: record.key.agentDefId,
    virtualKeyId: record.key.id,
    provider: record.provider,
    model: record.model,
    status: record.status,
    inputTokens: record.usage.inputTokens,
    outputTokens: record.usage.outputTokens,
    cacheRead: record.usage.cacheReadTokens,
    cacheWrite: record.usage.cacheWriteTokens,
    costCents: cost,
    priced: record.priced,
    latencyMs: Date.now() - record.startedAt,
    requestUri: envelopeUri,
    responseUri: envelopeUri,
    error: record.error,
  });

  const reservations = record.reservations ?? [];
  if (cost !== null && record.status === "ok") {
    const reservedBudgetIds = new Set(reservations.map((reservation) => reservation.budget.id));
    for (const budget of record.budgets) {
      if (!reservedBudgetIds.has(budget.id)) await addBudgetSpend(db, budget, record.key, cost);
    }
    await reconcileBudgetReservations(db, reservations, cost);
  } else {
    await reconcileBudgetReservations(db, reservations, 0);
  }

  await db
    .update(virtualKeys)
    .set({ updatedAt: new Date() })
    .where(eq(virtualKeys.id, record.key.id));
}
