import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { s as schema } from './schema-BknHlBAw.js';
import 'drizzle-orm';
import 'drizzle-orm/pg-core';

type Db = PostgresJsDatabase<typeof schema>;
type AuditInsert = {
    orgId: string;
    actor: {
        type: "user" | "key" | "agent" | "system";
        id?: string;
        name?: string;
    };
    action: string;
    target: {
        type: string;
        id?: string;
    };
    payload?: Record<string, unknown>;
    ip?: string;
    userAgent?: string;
};
declare function insertAuditEvent(db: Db, input: AuditInsert): Promise<{
    id: string;
    createdAt: Date;
    orgId: string;
    hash: string;
    seq: number;
    payload: unknown;
    actor: unknown;
    action: string;
    target: unknown;
    ip: string | null;
    userAgent: string | null;
    prevHash: string | null;
} | undefined>;
declare function verifyAuditChain(db: Db, orgId: string): Promise<{
    ok: boolean;
    firstBreakSeq: number;
} | {
    ok: boolean;
    firstBreakSeq: null;
}>;

export { type AuditInsert, insertAuditEvent, verifyAuditChain };
