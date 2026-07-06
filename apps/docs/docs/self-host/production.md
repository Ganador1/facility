---
title: Production
---

# Production deployment

The production shape is the same five containers against a managed Postgres
and any S3-compatible store. Deploy them with whatever runs containers in
your organization — ECS, Cloud Run, Kubernetes, Nomad, a VM with compose.

## Requirements

- **Postgres 16+** (managed recommended). One database; the platform runs its
  own migrations at deploy (`@facility/db migrate`).
- **S3-compatible object storage** — AWS S3, GCS (S3 mode), MinIO, R2.
  Facility signs envelope reads/writes with AWS SigV4 for both AWS S3 and
  configured `S3_ENDPOINT` stores.
- **Secrets**: `SECRET_MASTER_KEY` (32-byte base64 — everything sealed at
  rest derives from it; store it in your secret manager, rotate = re-seal),
  WorkOS credentials, GitHub App credentials.
- **TLS + a public URL** for the api (webhooks, OAuth callbacks) and web.

## Production deploy sequence

1. Build and publish immutable images for `api`, `worker`, `gateway`, and
   `web`.
2. Provision Postgres and object storage. Set `DATABASE_URL`, `S3_BUCKET`,
   and `AWS_REGION` for AWS S3. Credentials must come from static
   `S3_ACCESS_KEY`/`S3_SECRET_KEY`, standard AWS env credentials
   (`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`), or ECS/container
   credentials. For non-AWS S3-compatible stores, also set `S3_ENDPOINT` and
   use static `S3_ACCESS_KEY`/`S3_SECRET_KEY` unless that runtime supplies
   AWS-compatible credentials. The development compose stack auto-creates its
   MinIO bucket; external stores should be provisioned by your
   infrastructure.
3. Load secrets into the runtime: `SECRET_MASTER_KEY`, WorkOS variables, and
   the GitHub App variables when repo automation is enabled.
4. Run migrations once, before app traffic:

   ```bash
   pnpm --filter @facility/db migrate
   ```

5. Seed bundled roles, action types, registry essentials, and the default
   sandbox profile. Set `FACILITY_RUNNER_IMAGE` first (build/push the runner
   image from `runner/`) so the default profile can run platform-lane agents —
   otherwise `facility doctor` flags `sandbox_runner` and platform-lane runs
   never start:

   ```bash
   FACILITY_RUNNER_IMAGE=<your-runner-image> FACILITY_SEED_DEMO=0 pnpm --filter @facility/db seed
   ```

6. Start or roll the services in this order: `api`, `worker`, `gateway`,
   `web`.
7. Issue an owner/admin API key from the web settings page or bootstrap
   channel, then run the go/no-go check:

   ```bash
   facility doctor --url https://<api-host> --key fak_...
   ```

   Production is ready only when the doctor reports no `FAIL` checks. The
   command verifies database connectivity and migrations, object-store
   envelope write/read with SigV4, seed essentials, the `sandbox_runner` profile
   (its driver + runner image match this deployment), production `auth_config`
   (WorkOS configured when dev-login is off), GitHub App env completeness when
   enabled, and the org audit hash chain.

   The doctor runs through the API task's object-store configuration. Give
   the API and gateway identical `S3_*` and `AWS_REGION` env so the API-side
   round trip is a valid readiness proxy for gateway envelope writes.
   Envelope capture is best-effort with fail-loud logging: if a configured
   bucket rejects a write, the failure is logged and the metering row is still
   recorded.

## WorkOS SSO

Production authentication is WorkOS AuthKit (the dev-login path refuses to
enable in production):

1. Create a WorkOS environment; note client id + API key.
2. Set the redirect URI to `https://<api-host>/auth/callback`.
3. Configure your IdP connection (SAML/OIDC) in WorkOS.
4. Set `WORKOS_API_KEY`, `WORKOS_CLIENT_ID`, `WORKOS_COOKIE_PASSWORD` (32+
   random chars), `WORKOS_AUTHKIT_DOMAIN`.

### Remote MCP OAuth 2.1 (interactive clients)

To let interactive MCP clients (Claude, Cursor, ChatGPT) authenticate with WorkOS
OAuth 2.1 access tokens instead of `fak_` API keys, set **`MCP_OAUTH_AUDIENCE`**
on the api/worker/gateway runtime — the control plane keeps OAuth JWT auth
disabled until it is set (so audience is always validated). Run `facility-mcp
serve` with `MCP_PUBLIC_URL` (this MCP server's public URL) and
`MCP_AUTHORIZATION_SERVER` (defaults to `WORKOS_AUTHKIT_DOMAIN`) so it advertises
`/.well-known/oauth-protected-resource`. `fak_` keys keep working for services.

## GitHub App

Create a GitHub App in your org (the platform is installed **in your
environment** — no third-party App trust required):

- Permissions: contents RW, pull requests RW, issues RW, workflows R,
  checks R, members R (org), metadata R.
- Webhooks → `https://<api-host>/webhooks/github`, secret =
  `GITHUB_APP_WEBHOOK_SECRET`.
- Subscribe: installation, push, issues, issue_comment, pull_request,
  workflow_run.
- Set `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_SLUG`.

## Hardening checklist

- Postgres and MinIO/S3 unreachable from the public network.
- Gateway reachable from sandboxes and CI only (it holds no read endpoints,
  but it is the money path).
- Sandboxes on an isolated network segment; egress per profile.
- Backups: Postgres PITR + object-store lifecycle; audit retention per your
  compliance window.
- Keep `facility doctor --url https://<api-host> --key fak_...` in the release
  checklist after every deploy and migration.
