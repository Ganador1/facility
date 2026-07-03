import type { AuditInsert, FacilityDb } from "@facility/db";

export type Principal = {
  type: "user" | "key";
  id: string;
  orgId: string;
  userId?: string;
  projectId?: string | null;
  permissions: string[];
};

export type AppConfig = {
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
    audit: (
      action: string,
      target: AuditInsert["target"],
      payload?: Record<string, unknown>,
    ) => Promise<void>;
  }
  interface FastifyContextConfig {
    permission?: string;
    auditAction?: string;
    public?: boolean;
  }
}
