import { z } from 'zod';

declare const AUDIT_ACTIONS: readonly ["org.created", "org.updated", "member.added", "member.updated", "member.removed", "role.created", "role.updated", "role.deleted", "key.issued", "key.revoked", "project.created", "project.updated", "project.deleted", "repo.added", "repo.removed", "run.started", "run.canceled", "run.steered", "hitl.proposed", "hitl.decided", "registry.created", "registry.versioned", "registry.published", "registry.deprecated", "budget.breached", "provider.created", "provider.deleted", "kb.updated", "task.updated", "issue.acked", "issue.resolved", "auth.login", "auth.logout"];
declare const AuditEventSchema: z.ZodObject<{
    orgId: z.ZodString;
    actor: z.ZodObject<{
        type: z.ZodEnum<{
            user: "user";
            key: "key";
            agent: "agent";
            system: "system";
        }>;
        id: z.ZodOptional<z.ZodString>;
        name: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
    action: z.ZodString;
    target: z.ZodObject<{
        type: z.ZodString;
        id: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
    payload: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    ts: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
declare function hashChain(prevHash: string | null, event: unknown): string;

export { AUDIT_ACTIONS, AuditEventSchema, hashChain };
