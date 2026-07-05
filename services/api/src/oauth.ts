import { createRemoteJWKSet, type JWTVerifyGetKey, jwtVerify } from "jose";
import type { AppConfig } from "./types.js";

/**
 * OAuth 2.1 resource-server validation for WorkOS AuthKit access tokens.
 *
 * The control plane accepts three credential kinds: `Bearer fak_…` API keys,
 * the sealed session cookie, and — for interactive MCP clients (Claude, Cursor,
 * ChatGPT) that speak the MCP OAuth flow — a WorkOS-issued OAuth 2.1 access
 * token (a JWT). This module validates that JWT against WorkOS's JWKS and
 * returns the WorkOS user id, which the caller maps to a platform principal.
 *
 * Security posture:
 *  - Signature is verified against the issuer's JWKS (never the token's own
 *    material); the algorithm is pinned to RS256 so a token cannot downgrade to
 *    `none` or an HMAC alg-confusion attack.
 *  - `iss` is checked against the configured AuthKit issuer, `exp`/`nbf` are
 *    enforced by jose, and `aud` is enforced when an audience is configured.
 *  - The JWKS resolver is injectable so the logic is tested offline with a local
 *    key set; production lazily builds and caches a remote resolver per issuer.
 */

export type OauthConfig = {
  issuer: string;
  jwksUri: string;
  audience?: string;
};

export type AccessTokenClaims = {
  workosUserId: string;
  email?: string;
};

export class AccessTokenError extends Error {
  constructor(message = "Invalid access token") {
    super(message);
    this.name = "AccessTokenError";
  }
}

/**
 * Derive the OAuth resource-server config from app config. Returns null when
 * WorkOS AuthKit is not configured — in that case the JWT credential kind is
 * simply disabled and only API keys + sessions are accepted.
 */
export function oauthConfigFromApp(config: AppConfig): OauthConfig | null {
  const domain = normalizeAuthkitDomain(config.workosAuthkitDomain);
  if (!domain) return null;
  return {
    issuer: domain,
    jwksUri: `${domain}/oauth2/jwks`,
    audience: config.mcpOauthAudience,
  };
}

function normalizeAuthkitDomain(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
  return withScheme.replace(/\/+$/, "");
}

// One cached remote JWKS resolver per issuer — building it per request would
// refetch the key set and defeat jose's rotation-aware caching.
const remoteJwksCache = new Map<string, JWTVerifyGetKey>();

function remoteJwksForIssuer(config: OauthConfig): JWTVerifyGetKey {
  const cached = remoteJwksCache.get(config.jwksUri);
  if (cached) return cached;
  const resolver = createRemoteJWKSet(new URL(config.jwksUri));
  remoteJwksCache.set(config.jwksUri, resolver);
  return resolver;
}

/**
 * Verify a WorkOS access-token JWT and return its subject claims. Throws
 * AccessTokenError for any validation failure (bad signature, wrong issuer,
 * expired, wrong audience, missing subject, malformed token).
 *
 * `jwks` is injectable for tests; production omits it and a cached remote
 * resolver for the issuer is used.
 */
export async function verifyAccessToken(
  token: string,
  config: OauthConfig,
  jwks: JWTVerifyGetKey = remoteJwksForIssuer(config),
): Promise<AccessTokenClaims> {
  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: config.issuer,
      audience: config.audience,
      algorithms: ["RS256"],
    });
    const workosUserId = typeof payload.sub === "string" ? payload.sub : "";
    if (!workosUserId) throw new AccessTokenError("Access token has no subject");
    const email = typeof payload.email === "string" ? payload.email : undefined;
    return { workosUserId, email };
  } catch (error) {
    if (error instanceof AccessTokenError) throw error;
    throw new AccessTokenError();
  }
}

/** A `Bearer <token>` is JWT-shaped when it has three base64url segments. */
export function looksLikeJwt(token: string): boolean {
  const parts = token.split(".");
  return parts.length === 3 && parts.every((part) => part.length > 0);
}
