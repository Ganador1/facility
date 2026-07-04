import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";
import type { GatewayConfig } from "./types.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
loadDotenv({ path: join(repoRoot, ".env"), quiet: true });

const EnvSchema = z
  .object({
    DATABASE_URL: z.string().url(),
    SECRET_MASTER_KEY: z.string().min(1),
    GATEWAY_PORT: z.coerce.number().int().positive().default(4410),
    S3_ENDPOINT: z.string().optional(),
    S3_ACCESS_KEY: z.string().optional(),
    S3_SECRET_KEY: z.string().optional(),
    S3_BUCKET: z.string().optional(),
    AWS_REGION: z.string().optional(),
    LOG_LEVEL: z.string().default("info"),
    DEV_ANTHROPIC_API_KEY: z.string().optional(),
    DEV_OPENAI_API_KEY: z.string().optional(),
    FACILITY_INSECURE_DEV: z.string().optional(),
    NODE_ENV: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    const hasDevProviderKey = Boolean(env.DEV_ANTHROPIC_API_KEY || env.DEV_OPENAI_API_KEY);
    if (env.NODE_ENV === "production" && hasDevProviderKey && env.FACILITY_INSECURE_DEV !== "1") {
      ctx.addIssue({
        code: "custom",
        path: ["FACILITY_INSECURE_DEV"],
        message: "dev provider keys are refused in production without FACILITY_INSECURE_DEV=1",
      });
    }
  });

export function readConfig(env = process.env): GatewayConfig {
  const parsed = EnvSchema.parse(env);
  return {
    databaseUrl: parsed.DATABASE_URL,
    secretMasterKey: parsed.SECRET_MASTER_KEY,
    port: parsed.GATEWAY_PORT,
    s3Endpoint: parsed.S3_ENDPOINT,
    s3AccessKey: parsed.S3_ACCESS_KEY,
    s3SecretKey: parsed.S3_SECRET_KEY,
    s3Bucket: parsed.S3_BUCKET,
    awsRegion: parsed.AWS_REGION,
    logLevel: parsed.LOG_LEVEL,
    devAnthropicApiKey: parsed.DEV_ANTHROPIC_API_KEY,
    devOpenaiApiKey: parsed.DEV_OPENAI_API_KEY,
    facilityInsecureDev: parsed.FACILITY_INSECURE_DEV === "1",
    nodeEnv: parsed.NODE_ENV,
  };
}
