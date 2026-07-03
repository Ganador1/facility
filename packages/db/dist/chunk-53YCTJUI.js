import {
  auditEvents
} from "./chunk-QDVSSDUU.js";

// src/audit.ts
import { hashChain, newId } from "@facility/core";
import { desc, eq, sql } from "drizzle-orm";
async function insertAuditEvent(db, input) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${input.orgId}))`);
    const last = (await tx.select().from(auditEvents).where(eq(auditEvents.orgId, input.orgId)).orderBy(desc(auditEvents.seq)).limit(1))[0];
    const eventBody = {
      actor: input.actor,
      action: input.action,
      target: input.target,
      payload: input.payload ?? {}
    };
    const hash = hashChain(last?.hash ?? null, eventBody);
    const row = (await tx.insert(auditEvents).values({
      id: newId("evt"),
      orgId: input.orgId,
      actor: input.actor,
      action: input.action,
      target: input.target,
      payload: input.payload ?? {},
      ip: input.ip,
      userAgent: input.userAgent,
      prevHash: last?.hash ?? null,
      hash
    }).returning())[0];
    return row;
  });
}
async function verifyAuditChain(db, orgId) {
  const rows = await db.select().from(auditEvents).where(eq(auditEvents.orgId, orgId)).orderBy(auditEvents.seq);
  let prev = null;
  for (const row of rows) {
    const expected = hashChain(prev, {
      actor: row.actor,
      action: row.action,
      target: row.target,
      payload: row.payload
    });
    if (row.prevHash !== prev || row.hash !== expected) {
      return { ok: false, firstBreakSeq: row.seq };
    }
    prev = row.hash;
  }
  return { ok: true, firstBreakSeq: null };
}

export {
  insertAuditEvent,
  verifyAuditChain
};
