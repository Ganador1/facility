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
- **Secrets**: `SECRET_MASTER_KEY` (32-byte base64 — everything sealed at
  rest derives from it; store it in your secret manager, rotate = re-seal),
  WorkOS credentials, GitHub App credentials.
- **TLS + a public URL** for the api (webhooks, OAuth callbacks) and web.

## WorkOS SSO

Production authentication is WorkOS AuthKit (the dev-login path refuses to
enable in production):

1. Create a WorkOS environment; note client id + API key.
2. Set the redirect URI to `https://<api-host>/auth/callback`.
3. Configure your IdP connection (SAML/OIDC) in WorkOS.
4. Set `WORKOS_API_KEY`, `WORKOS_CLIENT_ID`, `WORKOS_COOKIE_PASSWORD` (32+
   random chars), `WORKOS_AUTHKIT_DOMAIN`.

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
- Run `facility doctor` (CLI) against the deployment for the wired-up check.
