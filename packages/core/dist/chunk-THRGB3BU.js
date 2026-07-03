// src/audit.ts
import { createHash } from "crypto";
import { z } from "zod";
var AUDIT_ACTIONS = [
  "org.created",
  "org.updated",
  "member.added",
  "member.updated",
  "member.removed",
  "role.created",
  "role.updated",
  "role.deleted",
  "key.issued",
  "key.revoked",
  "project.created",
  "project.updated",
  "project.deleted",
  "repo.added",
  "repo.removed",
  "run.started",
  "run.canceled",
  "run.steered",
  "hitl.proposed",
  "hitl.decided",
  "registry.created",
  "registry.versioned",
  "registry.published",
  "registry.deprecated",
  "budget.breached",
  "provider.created",
  "provider.deleted",
  "kb.updated",
  "task.updated",
  "issue.acked",
  "issue.resolved",
  "auth.login",
  "auth.logout"
];
var AuditEventSchema = z.object({
  orgId: z.string(),
  actor: z.object({
    type: z.enum(["user", "key", "agent", "system"]),
    id: z.string().optional(),
    name: z.string().optional()
  }),
  action: z.string(),
  target: z.object({ type: z.string(), id: z.string().optional() }),
  payload: z.record(z.string(), z.unknown()).optional(),
  ts: z.string().optional()
});
function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, inner]) => `${JSON.stringify(key)}:${stableStringify(inner)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
function hashChain(prevHash, event) {
  return createHash("sha256").update(`${prevHash ?? ""}:${stableStringify(event)}`).digest("hex");
}

export {
  AUDIT_ACTIONS,
  AuditEventSchema,
  hashChain
};
