import { FacilityDb, AuditInsert, createDb } from '@facility/db';
import { FastifyInstance } from 'fastify';

type Principal = {
    type: "user" | "key";
    id: string;
    orgId: string;
    userId?: string;
    projectId?: string | null;
    permissions: string[];
};
type AppConfig = {
    databaseUrl: string;
    secretMasterKey: string;
    port: number;
    publicUrl: string;
    webUrl?: string;
    workosApiKey?: string;
    workosClientId?: string;
    workosCookiePassword?: string;
    facilityInsecureDev: boolean;
    s3Endpoint?: string;
    s3AccessKey?: string;
    s3SecretKey?: string;
    s3Bucket?: string;
    logLevel: string;
};
declare module "fastify" {
    interface FastifyInstance {
        facilityDb: FacilityDb;
        enqueue: (queue: string, data: Record<string, unknown>) => Promise<string | null>;
    }
    interface FastifyRequest {
        principal?: Principal;
        audit: (action: string, target: AuditInsert["target"], payload?: Record<string, unknown>) => Promise<void>;
    }
    interface FastifyContextConfig {
        permission?: string;
        auditAction?: string;
        public?: boolean;
    }
}

declare function buildApp(config?: AppConfig): Promise<FastifyInstance>;
declare function mintSessionCookie(config: AppConfig, userId: string, orgId: string): Promise<string>;
declare function ensureDevUser(db: ReturnType<typeof createDb>["db"], email: string): Promise<{
    userId: string;
    orgId: string;
}>;

declare function readConfig(env?: NodeJS.ProcessEnv): AppConfig;

export { type AppConfig, type Principal, buildApp, ensureDevUser, mintSessionCookie, readConfig };
