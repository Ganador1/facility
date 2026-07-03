import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";
import type { AppConfig } from "./types.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
loadDotenv({ path: join(repoRoot, ".env"), quiet: true });

const EnvSchema = z
  .object({
    DATABASE_URL: z.string().url(),
    SECRET_MASTER_KEY: z.string().min(1),
    PORT: z.coerce.number().int().positive().default(4400),
    PUBLIC_URL: z.string().url().default("http://localhost:4400"),
    WEB_URL: z.string().url().optional(),
    WORKOS_API_KEY: z.string().optional(),
    WORKOS_CLIENT_ID: z.string().optional(),
    WORKOS_COOKIE_PASSWORD: z.string().optional(),
    FACILITY_INSECURE_DEV: z.string().optional(),
    S3_ENDPOINT: z.string().optional(),
    S3_ACCESS_KEY: z.string().optional(),
    S3_SECRET_KEY: z.string().optional(),
    S3_BUCKET: z.string().optional(),
    GITHUB_APP_ID: z.string().optional(),
    GITHUB_APP_PRIVATE_KEY: z.string().optional(),
    GITHUB_APP_WEBHOOK_SECRET: z.string().optional(),
    GITHUB_APP_SLUG: z.string().optional(),
    LOG_LEVEL: z.string().default("info"),
    NODE_ENV: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === "production" && env.FACILITY_INSECURE_DEV === "1") {
      ctx.addIssue({
        code: "custom",
        path: ["FACILITY_INSECURE_DEV"],
        message: "FACILITY_INSECURE_DEV is refused in production",
      });
    }
  });

export function readConfig(env = process.env): AppConfig {
  const parsed = EnvSchema.parse(env);
  return {
    databaseUrl: parsed.DATABASE_URL,
    secretMasterKey: parsed.SECRET_MASTER_KEY,
    port: parsed.PORT,
    publicUrl: parsed.PUBLIC_URL,
    webUrl: parsed.WEB_URL,
    workosApiKey: parsed.WORKOS_API_KEY,
    workosClientId: parsed.WORKOS_CLIENT_ID,
    workosCookiePassword: parsed.WORKOS_COOKIE_PASSWORD,
    facilityInsecureDev: parsed.FACILITY_INSECURE_DEV === "1",
    s3Endpoint: parsed.S3_ENDPOINT,
    s3AccessKey: parsed.S3_ACCESS_KEY,
    s3SecretKey: parsed.S3_SECRET_KEY,
    s3Bucket: parsed.S3_BUCKET,
    githubAppId: parsed.GITHUB_APP_ID,
    githubAppPrivateKey: parsed.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    githubAppWebhookSecret: parsed.GITHUB_APP_WEBHOOK_SECRET,
    githubAppSlug: parsed.GITHUB_APP_SLUG,
    logLevel: parsed.LOG_LEVEL,
  };
}
