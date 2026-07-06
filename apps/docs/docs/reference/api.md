---
title: API
---

# Control-plane API

REST, OpenAPI-described, permission-gated per route. In development the
interactive reference lives at `http://localhost:4400/docs`; the machine
spec is generated into `packages/sdk/openapi.json` and the typed TypeScript
client is `@facility/sdk`.

## Authentication

- **Session cookie** — web sign-in (WorkOS AuthKit or dev-login).
- **API key** — `Authorization: Bearer fak_…`, issued in Settings → Keys or
  `facility keys issue`; each key binds a role, so RBAC is identical for
  humans and machines.

## Conventions

- Base path `/v1`. JSON in, JSON out.
- Errors: `{ "error": { "code", "message", "details?" } }` with meaningful
  status codes; `403` includes the permission you lacked.
- Privileged v1 mutations (protected, non-GET routes that declare an audit action)
  are recorded in the append-only, hash-chained audit log on success; verify the
  org's chain with `GET /v1/audit/verify`. Webhook deliveries and run-lifecycle
  events are captured separately in their own event logs (`inbound_events`,
  `run_events`) — durable evidence, but not part of the audit hash chain.
- Streams (run events) are SSE: `GET /v1/runs/:id/stream`.

## Resource map

`/v1/me` · `/v1/org` · `/v1/members` · `/v1/roles` · `/v1/keys` ·
`/v1/projects` (+`/repos`, `/agents`, `/runs`, `/kb`, `/tasks`,
`/kickstart`, `/upgrade`) · `/v1/runs/:id` (+`/events`, `/stream`, `/steer`,
`/cancel`) · `/v1/registry` · `/v1/sandbox-profiles` · `/v1/providers` ·
`/v1/projects/:projectId/virtual-keys` · `/v1/budgets` · `/v1/spend` ·
`/v1/inbox` · `/v1/proposals` · `/v1/issues` · `/v1/analytics` · `/v1/audit` ·
`/v1/llm-requests` (+`/:requestId/envelope`) · `/v1/admin/doctor` ·
`/webhooks/github` · `/webhooks/inbound/:integrationId`.

The generated OpenAPI document is the authoritative, always-current
reference — this page is the orientation map.
