import { readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BUNDLED_ROLES } from "@facility/core";
import { actionTypes, roles, sandboxProfiles, verifyAuditChain } from "@facility/db";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { verifyEnvelopeRoundTrip } from "./envelopes.js";
import type { AppConfig } from "./types.js";

type Db = FastifyInstance["facilityDb"];

export const DoctorCheckSchema = z.object({
  id: z.string(),
  label: z.string(),
  status: z.enum(["pass", "warn", "fail"]),
  ok: z.boolean(),
  message: z.string(),
  remediation: z.string().optional(),
});

export const DoctorResponseSchema = z.object({
  ok: z.boolean(),
  generatedAt: z.string(),
  checks: z.array(DoctorCheckSchema),
});

export type DoctorCheck = z.infer<typeof DoctorCheckSchema>;
export type DoctorResponse = z.infer<typeof DoctorResponseSchema>;

const ESSENTIAL_ACTION_TYPES = [
  "budget_override",
  "guard_candidate",
  "kb_amendment",
  "kickstart_review",
  "learning_validation",
  "mcp_tool_call",
  "plan_acceptance",
  "rule_proposal",
  "skill_proposal",
  "task_creation",
];

const here = dirname(fileURLToPath(import.meta.url));

export async function runReadinessDoctor(input: {
  db: Db;
  config: AppConfig;
  orgId: string;
  now?: Date;
}): Promise<DoctorResponse> {
  const now = input.now ?? new Date();
  const checks = await Promise.all([
    checkDatabase(input.db),
    checkObjectStorage(input.config, input.orgId, now),
    checkSeedEssentials(input.db, input.orgId),
    checkGithubApp(input.config),
    checkAuthConfig(input.config),
    checkAuditHashChain(input.db, input.orgId),
  ]);
  return {
    ok: checks.every((check) => check.status !== "fail"),
    generatedAt: now.toISOString(),
    checks,
  };
}

async function expectedMigrationNames(): Promise<string[]> {
  const candidates = [
    join(here, "../../../packages/db/migrations"),
    join(here, "../../packages/db/migrations"),
  ];
  for (const dir of candidates) {
    try {
      return (await readdir(dir)).filter((file) => file.endsWith(".sql")).sort();
    } catch {
      // Try the next source/dist relative path.
    }
  }
  throw new Error("Could not locate packages/db/migrations");
}

async function checkDatabase(db: Db): Promise<DoctorCheck> {
  try {
    await db.execute(sql`select 1`);
    const expected = await expectedMigrationNames();
    const appliedRows = (await db.execute(
      sql`select name from _facility_migrations order by name`,
    )) as Iterable<{ name: string }>;
    const applied = new Set(Array.from(appliedRows).map((row) => row.name));
    const missing = expected.filter((name) => !applied.has(name));
    if (missing.length > 0) {
      return fail(
        "database",
        "Database connectivity and migrations",
        `Database is reachable, but ${missing.length} migration(s) are missing.`,
        `Run \`pnpm --filter @facility/db migrate\`; first missing migration: ${missing[0]}.`,
      );
    }
    return pass(
      "database",
      "Database connectivity and migrations",
      `Database is reachable; ${expected.length} migration(s) applied.`,
    );
  } catch (error) {
    return fail(
      "database",
      "Database connectivity and migrations",
      error instanceof Error ? error.message : "Database readiness check failed.",
      "Verify DATABASE_URL and run `pnpm --filter @facility/db migrate`.",
    );
  }
}

async function checkObjectStorage(
  config: AppConfig,
  orgId: string,
  now: Date,
): Promise<DoctorCheck> {
  if (!config.s3Bucket) {
    return fail(
      "object_storage",
      "Object storage envelope round trip",
      "Object storage not configured: S3_BUCKET is empty.",
      "Set S3_BUCKET plus S3_ENDPOINT for S3-compatible stores, or AWS_REGION/AWS credentials for AWS S3.",
    );
  }
  const payload = { type: "facility-doctor", orgId, at: now.toISOString() };
  try {
    const roundTrip = await verifyEnvelopeRoundTrip({
      config,
      orgId,
      requestId: `doctor_${now.getTime()}`,
      payload,
      now,
    });
    if (JSON.stringify(roundTrip.loaded) !== JSON.stringify(payload)) {
      return fail(
        "object_storage",
        "Object storage envelope round trip",
        "Envelope store returned different content than it wrote.",
        "Check bucket routing, credentials, and any proxy in front of the S3-compatible endpoint.",
      );
    }
    return pass(
      "object_storage",
      "Object storage envelope round trip",
      `Wrote and read ${roundTrip.uri}.`,
    );
  } catch (error) {
    return fail(
      "object_storage",
      "Object storage envelope round trip",
      error instanceof Error ? error.message : "Object storage round trip failed.",
      "Verify S3_BUCKET, S3_ENDPOINT/AWS_REGION, and write/read permissions for the API and gateway tasks.",
    );
  }
}

async function checkSeedEssentials(db: Db, orgId: string): Promise<DoctorCheck> {
  try {
    const bundledRoleNames = BUNDLED_ROLES.filter((role) =>
      ["owner", "viewer"].includes(role.name),
    ).map((role) => role.name);
    const seededRoles = await db
      .select({ name: roles.name })
      .from(roles)
      .where(and(isNull(roles.orgId), inArray(roles.name, bundledRoleNames)));
    const seededActionTypes = await db
      .select({ name: actionTypes.name })
      .from(actionTypes)
      .where(and(eq(actionTypes.orgId, orgId), inArray(actionTypes.name, ESSENTIAL_ACTION_TYPES)));
    const seededSandboxProfiles = await db
      .select({ id: sandboxProfiles.id })
      .from(sandboxProfiles)
      .where(eq(sandboxProfiles.orgId, orgId))
      .limit(1);
    const missingRoles = bundledRoleNames.filter(
      (name) => !seededRoles.some((role) => role.name === name),
    );
    const missingActionTypes = ESSENTIAL_ACTION_TYPES.filter(
      (name) => !seededActionTypes.some((actionType) => actionType.name === name),
    );
    const missing = [
      ...missingRoles.map((name) => `role:${name}`),
      ...missingActionTypes.map((name) => `action:${name}`),
      ...(seededSandboxProfiles.length > 0 ? [] : ["sandbox:default"]),
    ];
    if (missing.length > 0) {
      return fail(
        "seed_essentials",
        "Bundled seed essentials",
        `Missing ${missing.length} seed essential(s): ${missing.join(", ")}.`,
        "Run `FACILITY_SEED_DEMO=0 pnpm --filter @facility/db seed` after migrations.",
      );
    }
    return pass(
      "seed_essentials",
      "Bundled seed essentials",
      "Owner/viewer roles, action types, and a sandbox profile are present.",
    );
  } catch (error) {
    return fail(
      "seed_essentials",
      "Bundled seed essentials",
      error instanceof Error ? error.message : "Seed readiness check failed.",
      "Run database migrations, then seed the deployment.",
    );
  }
}

function checkGithubApp(config: AppConfig): DoctorCheck {
  const values = {
    GITHUB_APP_ID: config.githubAppId,
    GITHUB_APP_PRIVATE_KEY: config.githubAppPrivateKey,
    GITHUB_APP_WEBHOOK_SECRET: config.githubAppWebhookSecret,
    GITHUB_APP_SLUG: config.githubAppSlug,
  };
  const present = Object.entries(values).filter(([, value]) => Boolean(value));
  if (present.length === 0) {
    return warn(
      "github_app",
      "GitHub App configuration",
      "GitHub App is not enabled.",
      "Set GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, GITHUB_APP_WEBHOOK_SECRET, and GITHUB_APP_SLUG before using repo automation.",
    );
  }
  const missing = Object.entries(values)
    .filter(([, value]) => !value)
    .map(([key]) => key);
  if (missing.length > 0) {
    return fail(
      "github_app",
      "GitHub App configuration",
      `GitHub App is partially configured; missing ${missing.join(", ")}.`,
      "Complete the GitHub App environment variables or remove all of them to disable GitHub automation.",
    );
  }
  return pass("github_app", "GitHub App configuration", "Required GitHub App values are set.");
}

function checkAuthConfig(config: AppConfig): DoctorCheck {
  const domain = Boolean(config.workosAuthkitDomain);
  const audience = Boolean(config.mcpOauthAudience);
  const workosConfigured = Boolean(
    config.workosApiKey && config.workosClientId && config.workosAuthkitDomain,
  );
  // A half-configured OAuth resource server fails closed at runtime (JWT auth
  // stays off), so surface it rather than reporting a false "ready".
  if (audience && !domain) {
    return fail(
      "auth_config",
      "Authentication configuration",
      "MCP_OAUTH_AUDIENCE is set but WORKOS_AUTHKIT_DOMAIN is missing — OAuth JWT auth will not enable.",
      "Set WORKOS_AUTHKIT_DOMAIN (the WorkOS AuthKit issuer) alongside MCP_OAUTH_AUDIENCE.",
    );
  }
  if (!workosConfigured) {
    return warn(
      "auth_config",
      "Authentication configuration",
      "WorkOS SSO is not fully configured (session + dev-login still work).",
      "Set WORKOS_API_KEY, WORKOS_CLIENT_ID, and WORKOS_AUTHKIT_DOMAIN for production SSO.",
    );
  }
  if (!audience) {
    return warn(
      "auth_config",
      "Authentication configuration",
      "WorkOS AuthKit is configured but MCP_OAUTH_AUDIENCE is unset — interactive MCP OAuth is disabled (fak_ keys only).",
      "Set MCP_OAUTH_AUDIENCE to enable OAuth 2.1 access-token auth for interactive MCP clients.",
    );
  }
  return pass(
    "auth_config",
    "Authentication configuration",
    "WorkOS SSO and the MCP OAuth audience are configured.",
  );
}

async function checkAuditHashChain(db: Db, orgId: string): Promise<DoctorCheck> {
  const result = await verifyAuditChain(db, orgId);
  if (!result.ok) {
    return fail(
      "audit_hash_chain",
      "Audit hash-chain verification",
      `Audit chain breaks at sequence ${result.firstBreakSeq}.`,
      "Stop writes, preserve the database, and investigate audit_events before resuming production traffic.",
    );
  }
  return pass("audit_hash_chain", "Audit hash-chain verification", "Audit chain verifies.");
}

function pass(id: string, label: string, message: string): DoctorCheck {
  return { id, label, status: "pass", ok: true, message };
}

function warn(id: string, label: string, message: string, remediation?: string): DoctorCheck {
  return { id, label, status: "warn", ok: true, message, remediation };
}

function fail(id: string, label: string, message: string, remediation?: string): DoctorCheck {
  return { id, label, status: "fail", ok: false, message, remediation };
}
