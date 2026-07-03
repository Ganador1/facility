import { keyLookup, open, verifyKey } from "@facility/core";
import type { FacilityDb } from "@facility/db";
import { providerCredentials, runs, virtualKeys } from "@facility/db";
import { and, eq, isNull } from "drizzle-orm";
import type { AuthedKey, GatewayConfig, Provider, ProviderCredential } from "./types.js";

const keyCache = new Map<
  string,
  { expiresAt: number; row: AuthedKey & { hash: string }; secret?: string }
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
  const row =
    cached && cached.expiresAt > now
      ? cached.row
      : await loadVirtualKeyByPrefix(db, lookup, now + 60_000);
  if (!row) return null;
  if (cached?.secret === secret && cached.expiresAt > now) return row;
  if (!(await verifyKey(secret, row.hash))) return null;
  keyCache.set(lookup, { expiresAt: now + 60_000, row, secret });
  return row;
}

async function loadVirtualKeyByPrefix(
  db: FacilityDb,
  lookup: string,
  expiresAt: number,
): Promise<(AuthedKey & { hash: string }) | null> {
  const rows = await db
    .select({ key: virtualKeys, run: runs })
    .from(virtualKeys)
    .leftJoin(runs, eq(virtualKeys.runId, runs.id))
    .where(and(eq(virtualKeys.prefix, lookup), isNull(virtualKeys.revokedAt)))
    .limit(2);
  const row = rows[0];
  if (!row) return null;
  if (row.key.expiresAt && row.key.expiresAt.getTime() <= Date.now()) return null;
  const loaded = {
    id: row.key.id,
    orgId: row.key.orgId,
    projectId: row.key.projectId,
    runId: row.key.runId,
    allowedModels: row.key.allowedModels,
    budgetId: row.key.budgetId,
    agentDefId: row.run?.agentDefId ?? null,
    hash: row.key.hash,
  };
  keyCache.set(lookup, { expiresAt, row: loaded });
  return loaded;
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
    const credential = { apiKey: fallback, baseUrl: defaultBaseUrl(provider) };
    credentialCache.set(cacheKey, { expiresAt: Date.now() + 60_000, credential });
    return credential;
  }
  if (!row) throw new Error(`missing ${provider} provider credential`);

  const credential = {
    apiKey: await open(row.sealedSecret, config.secretMasterKey),
    baseUrl: row.baseUrl ?? defaultBaseUrl(provider),
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
