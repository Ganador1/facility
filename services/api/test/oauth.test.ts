import { newId } from "@facility/core";
import { createDb, migrate, orgMembers, seed, users } from "@facility/db";
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type JWK,
  type JWTVerifyGetKey,
  SignJWT,
} from "jose";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import {
  AccessTokenError,
  looksLikeJwt,
  oauthConfigFromApp,
  verifyAccessToken,
} from "../src/oauth.js";
import type { AppConfig } from "../src/types.js";

const databaseUrl =
  process.env.DATABASE_URL ?? "postgres://facility:facility@localhost:5461/facility";
const masterKey = Buffer.alloc(32, 7).toString("base64");
const ISSUER = "https://auth.facility.test";

const config: AppConfig = {
  databaseUrl,
  secretMasterKey: masterKey,
  port: 4400,
  publicUrl: "http://localhost:4400",
  sandboxApiUrl: "http://localhost:4400",
  sandboxGatewayUrl: "http://localhost:4410",
  webUrl: "http://localhost:3000",
  facilityInsecureDev: true,
  logLevel: "silent",
  workosApiKey: "sk_test",
  workosClientId: "client_test",
  workosAuthkitDomain: ISSUER,
};

async function canConnect() {
  const sqlClient = postgres(databaseUrl, { max: 1, connect_timeout: 2 });
  try {
    await sqlClient`select 1`;
    return true;
  } catch {
    return false;
  } finally {
    await sqlClient.end().catch(() => undefined);
  }
}

describe("oauth resource server", async () => {
  const reachable = await canConnect();
  if (!reachable) {
    it.skip("Postgres unreachable; OAuth integration tests skipped", () => undefined);
    return;
  }

  const oauthConfig = oauthConfigFromApp(config);
  if (!oauthConfig) throw new Error("oauth config should be derivable");

  // A signing keypair + the JWKS the resource server trusts. Injected into the
  // app so validation runs fully offline against a local key set.
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const publicJwk: JWK = { ...(await exportJWK(publicKey)), kid: "test-key", alg: "RS256" };
  const jwks: JWTVerifyGetKey = createLocalJWKSet({ keys: [publicJwk] });

  // A second, untrusted keypair — tokens signed with it must be rejected.
  const foreign = await generateKeyPair("RS256");
  type SignKey = Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];
  // Run-unique WorkOS subject: users.workos_user_id is unique, so a fixed value
  // would collide on the shared dev database across runs.
  const subject = `workos_user_${Date.now()}`;
  // Email is also unique; derive it from the run-unique subject.
  const email = `${subject}-oauth@example.com`;

  async function signToken(
    overrides: {
      sub?: string;
      issuer?: string;
      expSeconds?: number;
      audience?: string;
      alg?: string;
      key?: SignKey;
    } = {},
  ) {
    const jwt = new SignJWT({ email })
      .setProtectedHeader({ alg: overrides.alg ?? "RS256", kid: "test-key" })
      .setIssuer(overrides.issuer ?? ISSUER)
      .setSubject(overrides.sub ?? subject)
      .setIssuedAt()
      .setExpirationTime(`${overrides.expSeconds ?? 3600}s`);
    if (overrides.audience) jwt.setAudience(overrides.audience);
    return jwt.sign(overrides.key ?? privateKey);
  }

  const app = await buildApp(config, { oauthJwks: jwks });
  const { db, client } = createDb(databaseUrl);
  let orgId = "";
  let fakKey = "";

  beforeAll(async () => {
    await migrate(databaseUrl);
    await seed(databaseUrl);
    await app.ready();

    // An org + an owner session to mint a real API key (for the fak_ path).
    const login = await app.inject({
      method: "POST",
      url: "/auth/dev-login",
      payload: { email: `oauth-owner-${Date.now()}@example.com` },
    });
    expect(login.statusCode).toBe(200);
    orgId = login.json().orgId;
    const cookie = login.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    const key = await app.inject({
      method: "POST",
      url: "/v1/keys",
      headers: { cookie },
      payload: { name: `oauth-fak-${Date.now()}`, roleId: "role_bundled_owner" },
    });
    expect(key.statusCode).toBe(200);
    fakKey = key.json().secret;

    // A WorkOS-authenticated member: users.workos_user_id links the JWT subject
    // to a platform member.
    const userId = newId("user");
    await db.insert(users).values({
      id: userId,
      workosUserId: subject,
      email,
      name: "OAuth User",
      status: "active",
    });
    await db.insert(orgMembers).values({
      id: newId("user"),
      orgId,
      userId,
      roleId: "role_bundled_owner",
    });
  });

  afterAll(async () => {
    await app.close();
    await client.end();
  });

  // --- unit: verifyAccessToken security matrix (offline) ---

  it("accepts a correctly signed, unexpired token from the trusted issuer", async () => {
    const claims = await verifyAccessToken(await signToken(), oauthConfig, jwks);
    expect(claims.workosUserId).toBe(subject);
    expect(claims.email).toBe(email);
  });

  it("rejects an expired token", async () => {
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer(ISSUER)
      .setSubject(subject)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(privateKey);
    await expect(verifyAccessToken(token, oauthConfig, jwks)).rejects.toBeInstanceOf(
      AccessTokenError,
    );
  });

  it("rejects a token from the wrong issuer", async () => {
    await expect(
      verifyAccessToken(await signToken({ issuer: "https://evil.example" }), oauthConfig, jwks),
    ).rejects.toBeInstanceOf(AccessTokenError);
  });

  it("rejects a token signed by an untrusted key", async () => {
    await expect(
      verifyAccessToken(await signToken({ key: foreign.privateKey }), oauthConfig, jwks),
    ).rejects.toBeInstanceOf(AccessTokenError);
  });

  it("enforces audience when configured", async () => {
    const audienceConfig = { ...oauthConfig, audience: "facility-mcp" };
    await expect(verifyAccessToken(await signToken(), audienceConfig, jwks)).rejects.toBeInstanceOf(
      AccessTokenError,
    );
    const ok = await verifyAccessToken(
      await signToken({ audience: "facility-mcp" }),
      audienceConfig,
      jwks,
    );
    expect(ok.workosUserId).toBe(subject);
  });

  it("classifies JWT-shaped strings", () => {
    expect(looksLikeJwt("aaa.bbb.ccc")).toBe(true);
    expect(looksLikeJwt("fak_abc123")).toBe(false);
    expect(looksLikeJwt("aaa.bbb")).toBe(false);
  });

  // --- integration: resolvePrincipal accepts the token end to end ---

  it("authenticates an API request with a valid OAuth access token", async () => {
    const me = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { authorization: `Bearer ${await signToken()}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().principal.email).toBe(email);
    expect(me.json().principal.orgId).toBe(orgId);
  });

  it("rejects an expired token at the API with 401", async () => {
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer(ISSUER)
      .setSubject(subject)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(privateKey);
    const me = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(me.statusCode).toBe(401);
  });

  it("forbids a valid token whose subject has no platform membership", async () => {
    const me = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { authorization: `Bearer ${await signToken({ sub: "workos_user_unknown" })}` },
    });
    expect(me.statusCode).toBe(403);
  });

  it("still accepts fak_ API keys and rejects missing auth", async () => {
    const withKey = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { authorization: `Bearer ${fakKey}` },
    });
    expect(withKey.statusCode).toBe(200);
    const anon = await app.inject({ method: "GET", url: "/v1/me" });
    expect(anon.statusCode).toBe(401);
  });
});
