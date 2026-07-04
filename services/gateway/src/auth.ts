import { keyLookup, open, validateProviderBaseUrl, verifyKey } from "@facility/core";
import type { FacilityDb } from "@facility/db";
import { providerCredentials, runs, virtualKeys } from "@facility/db";
import { and, eq, isNull } from "drizzle-orm";
import type { AuthedKey, GatewayConfig, Provider, ProviderCredential } from "./types.js";

// Short cache TTL bounds how long a revoked run key can survive in the gateway
// (revocation happens in the api process; the gateway can't be signalled
// synchronously, so the ceiling is this TTL). Run keys also carry their own
// expiry, enforced on every hit regardless of cache.
const KEY_CACHE_TTL_MS = 15_000;
const keyCache = new Map<
  string,
  {
    cacheExpiresAt: number;
    keyExpiresAt: number | null;
    row: AuthedKey & { hash: string };
    secret: string;
  }
>();
const credentialCache = new Map<string, { expiresAt: number; credential: ProviderCredential }>();

export function virtualKeyFromHeaders(headers: Record<string, unknown>): string | null {
  const authorization = typeof headers.authorization === "string" ? headers.authorization : "";
  if (authorization.startsWith("Bearer fvk_")) return authorization.slice("Bearer ".length);
  const anthropicKey = headers["x-api-key"];
  return typeof anthropicKey === "string" && anthropicKey.startsWith("fvk_") ? anthropicKey : null;
}

export async function authenticateVirtualKey(
  db: FacilityDb,
  secret: string,
  now = Date.now(),
): Promise<AuthedKey | null> {
  const lookup = keyLookup(secret);
  const cached = keyCache.get(lookup);
  if (
    cached &&
    cached.secret === secret &&
    cached.cacheExpiresAt > now &&
    (cached.keyExpiresAt === null || cached.keyExpiresAt > now)
  ) {
    return cached.row;
  }
  const loaded = await loadVirtualKeyByPrefix(db, lookup, secret, now);
  if (!loaded) return null;
  keyCache.set(lookup, {
    cacheExpiresAt: now + KEY_CACHE_TTL_MS,
    keyExpiresAt: loaded.keyExpiresAt,
    row: loaded.row,
    secret,
  });
  return loaded.row;
}

async function loadVirtualKeyByPrefix(
  db: FacilityDb,
  lookup: string,
  secret: string,
  now: number,
): Promise<{ row: AuthedKey & { hash: string }; keyExpiresAt: number | null } | null> {
  // Verify against every non-revoked key sharing this prefix, not just the
  // first — a prefix collision must not make a valid key fail (finding #6).
  const rows = await db
    .select({ key: virtualKeys, run: runs })
    .from(virtualKeys)
    .leftJoin(runs, eq(virtualKeys.runId, runs.id))
    .where(and(eq(virtualKeys.prefix, lookup), isNull(virtualKeys.revokedAt)))
    .limit(8);
  for (const row of rows) {
    const keyExpiresAt = row.key.expiresAt ? row.key.expiresAt.getTime() : null;
    if (keyExpiresAt !== null && keyExpiresAt <= now) continue;
    if (!(await verifyKey(secret, row.key.hash))) continue;
    return {
      keyExpiresAt,
      row: {
        id: row.key.id,
        orgId: row.key.orgId,
        projectId: row.key.projectId,
        runId: row.key.runId,
        taskId: taskIdFromRunTrigger(row.run?.trigger),
        allowedModels: row.key.allowedModels,
        budgetId: row.key.budgetId,
        agentDefId: row.run?.agentDefId ?? null,
        hash: row.key.hash,
      },
    };
  }
  return null;
}

export async function providerCredential(
  db: FacilityDb,
  config: GatewayConfig,
  provider: Provider,
  orgId: string,
): Promise<ProviderCredential> {
  const cacheKey = `${orgId}:${provider}`;
  const cached = credentialCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.credential;

  const row = (
    await db
      .select()
      .from(providerCredentials)
      .where(and(eq(providerCredentials.orgId, orgId), eq(providerCredentials.provider, provider)))
      .limit(1)
  )[0];

  const fallback = provider === "anthropic" ? config.devAnthropicApiKey : config.devOpenaiApiKey;
  if (!row && fallback) {
    if (config.nodeEnv === "production" && !config.facilityInsecureDev) {
      throw new Error("dev provider key fallback refused in production");
    }
    const credential = {
      apiKey: fallback,
      baseUrl: await validateProviderBaseUrl(defaultBaseUrl(provider), {
        allowLocalhostHttp: config.facilityInsecureDev,
      }),
    };
    credentialCache.set(cacheKey, { expiresAt: Date.now() + 60_000, credential });
    return credential;
  }
  if (!row) throw new Error(`missing ${provider} provider credential`);

  const credential = {
    apiKey: await open(row.sealedSecret, config.secretMasterKey),
    baseUrl: await validateProviderBaseUrl(row.baseUrl ?? defaultBaseUrl(provider), {
      allowLocalhostHttp: config.facilityInsecureDev,
    }),
  };
  credentialCache.set(cacheKey, { expiresAt: Date.now() + 60_000, credential });
  return credential;
}

export function clearAuthCaches() {
  keyCache.clear();
  credentialCache.clear();
}

function defaultBaseUrl(provider: Provider): string {
  return provider === "anthropic" ? "https://api.anthropic.com/v1" : "https://api.openai.com/v1";
}

function taskIdFromRunTrigger(trigger: unknown): string | null {
  if (!trigger || typeof trigger !== "object" || Array.isArray(trigger)) return null;
  const taskId = (trigger as { taskId?: unknown }).taskId;
  return typeof taskId === "string" && taskId ? taskId : null;
}
