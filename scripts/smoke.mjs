#!/usr/bin/env node
// End-to-end smoke test for a running Facility stack.
//   API=http://localhost:4400 GATEWAY=http://localhost:4410 node scripts/smoke.mjs
//
// Exercises the real seams: dev-login → project → virtual key → a live model
// call proxied through the gateway → metering + audit chain. Exits non-zero on
// the first failure. Requires FACILITY_INSECURE_DEV on the API and a provider
// key reachable by the gateway (sealed credential or DEV_*_API_KEY).
import process from "node:process";

const API = process.env.API ?? "http://localhost:4400";
const GATEWAY = process.env.GATEWAY ?? "http://localhost:4410";
const EMAIL = process.env.SMOKE_EMAIL ?? "smoke@theagilemonkeys.com";
const MODEL = process.env.SMOKE_MODEL ?? "claude-haiku-4-5-20251001";

let cookie = "";
const steps = [];
function ok(name, detail = "") {
  steps.push({ name, ok: true, detail });
  console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`);
}
function fail(name, err) {
  console.error(`  ✗ ${name} — ${err}`);
  console.error("\nSMOKE FAILED");
  process.exit(1);
}

async function api(path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}), ...init.headers },
  });
  const body = await res.json().catch(() => null);
  return { res, body };
}

async function main() {
  console.log(`Facility smoke — api ${API}, gateway ${GATEWAY}\n`);

  {
    const { res, body } = await api("/health");
    if (!res.ok || !body?.ok) fail("api health", JSON.stringify(body));
    ok("api health", `db ${body.db}`);
  }
  {
    const res = await fetch(`${GATEWAY}/health`);
    if (!res.ok) fail("gateway health", res.status);
    ok("gateway health");
  }
  {
    const { res, body, ...rest } = await apiSetCookie("/auth/dev-login", {
      method: "POST",
      body: JSON.stringify({ email: EMAIL }),
    });
    if (!res.ok) fail("dev-login", JSON.stringify(body));
    ok("dev-login", body.orgId);
  }
  {
    const { res, body } = await api("/v1/me");
    if (!res.ok || !body?.permissions?.length) fail("/v1/me", JSON.stringify(body));
    ok("/v1/me", `${body.permissions.length} perms`);
  }
  let projectId;
  {
    const slug = `smoke-${Date.now()}`;
    const { res, body } = await api("/v1/projects", {
      method: "POST",
      body: JSON.stringify({ name: "Smoke", slug }),
    });
    if (!res.ok || !body?.id) fail("create project", JSON.stringify(body));
    projectId = body.id;
    ok("create project", slug);
  }
  let vkey;
  {
    const { res, body } = await api(`/v1/projects/${projectId}/virtual-keys`, {
      method: "POST",
      body: JSON.stringify({ name: "smoke" }),
    });
    if (!res.ok || !body?.secret) fail("mint virtual key", JSON.stringify(body));
    vkey = body.secret;
    ok("mint virtual key", `${vkey.slice(0, 12)}…`);
  }
  {
    const res = await fetch(`${GATEWAY}/anthropic/v1/messages`, {
      method: "POST",
      headers: {
        "x-api-key": vkey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 20,
        messages: [{ role: "user", content: "say hi" }],
      }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || body?.type === "error") fail("proxied model call", JSON.stringify(body));
    ok("proxied model call", body?.content?.[0]?.text?.slice(0, 24) ?? "ok");
  }
  {
    const { res, body } = await api("/v1/audit/verify");
    if (!res.ok || body?.ok !== true) fail("audit chain verify", JSON.stringify(body));
    ok("audit chain verify", "intact");
  }

  console.log(`\nSMOKE PASSED (${steps.length} checks)`);
}

// dev-login needs to capture the Set-Cookie for subsequent calls
async function apiSetCookie(path, init) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init.headers },
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  const body = await res.json().catch(() => null);
  return { res, body };
}

main().catch((err) => fail("unexpected", err?.message ?? String(err)));
