# Spec: platform MCP server (packages/mcp) + CLI platform commands (packages/cli)

**Scope**: the AI-operable management surface. An MCP server exposing governed platform tools (same RBAC as everything else) over stdio and streamable HTTP, and the `facility` CLI gaining platform commands next to its vendored-install commands. Both consume `@facility/sdk`.

Read first: control-plane.md (routes + permissions), discovery/tam-os.md (§MCP — the write-confirmation pattern is binding), ARCHITECTURE.md ADR 9/20.

## packages/mcp (`@facility/mcp`)

`@modelcontextprotocol/sdk` (official TS SDK). Two transports:
- stdio (`facility-mcp` bin): auth from `FACILITY_API_KEY` + `FACILITY_API_URL` env.
- streamable HTTP (`facility-mcp serve --port 4420`): `Authorization: Bearer fak_…` per request. (WorkOS OAuth relay = later phase; API keys are the v1 path and stay supported forever.)

Tools (names `facility_*`; JSON Schema inputs via zod-to-json-schema; every description written for an operator LLM — concise, states permissions needed):

Read: `facility_me`, `facility_list_projects`, `facility_get_project`, `facility_list_runs` {projectId?, status?}, `facility_get_run` (+ last N events inline, N≤50), `facility_list_inbox`, `facility_get_proposal`, `facility_spend` {projectId?, groupBy}, `facility_list_registry` {kind?}, `facility_get_registry_item` (+active version content), `facility_list_issues`, `facility_audit_tail` {limit≤100}, `facility_llm_requests` {projectId?, from?, to?, limit?, cursor?}, `facility_llm_request_envelope` {requestId}, `facility_list_budgets`, `facility_kickstart_preview` {projectId, repoId}.

Raw metering corpus: `/v1/llm-requests` lists durable LLM request rows for data mining. `/v1/llm-requests/:requestId/envelope` returns the stored request/response envelope for one row, scoped to the caller's org and project. The envelope endpoint accepts `spend:read` or `audit:read`; project-scoped keys get 404 for another project's request.

Write (ALL require confirmation tokens — the tam-os pattern via core.mintConfirmation, TTL 5min): `facility_trigger_run` {projectId, agentName, input}, `facility_cancel_run`, `facility_steer_run` {runId, body}, `facility_decide_proposal` {proposalId, decision, note?}, `facility_create_project`, `facility_kickstart` {projectId, repoId, answers}, `facility_upgrade_project`, `facility_set_budget`, `facility_publish_registry_version`, `facility_create_agent` {projectId, name, engine, model, contractItemId|contractContent, triggers, sandboxProfileId?}.

Confirmation flow: write tool called WITHOUT `confirm_token` → returns {requires_confirmation: true, token, summary (human-readable action description), expires_in_s} and does nothing. Called WITH valid token bound to same tool+args-hash → executes. This makes destructive one-shots impossible for AI clients while staying scriptable.

Resources: `facility://me`, `facility://projects/{id}`, `facility://runs/{id}` (transcript window template). Prompts: `facility-status` (org-wide state brief), `facility-run-triage` (stuck-run diagnosis walkthrough), `facility-cost-review`.

Server never talks to the DB — SDK/HTTP only, so RBAC/audit apply identically (the API is the boundary). Map API errors → MCP tool errors with the `needed` permission surfaced.

## packages/cli additions

New commands (zero-dep rule stays — use global fetch; no SDK dep here to keep the npx footprint tiny; a small hand-rolled client mirroring sdk paths is fine):
- `facility login` — prompts for API URL + key (or `--url --key`), verifies via /v1/me, stores in `~/.facility/config.json` (0600) with named profiles (`--profile`).
- `facility status` — org overview: live runs, open inbox, spend MTD, issues (the CLI twin of the web overview).
- `facility projects list|get <slug>`
- `facility runs list [--project] [--status]`, `facility runs watch <id>` (SSE tail rendering events as colored lines), `facility runs trigger <project> <agent> [--input]`, `facility runs steer <id> <message>`
- `facility inbox` (list) and `facility inbox decide <id> approve|reject [--note]`
- `facility kickstart <project> --repo owner/name [--yes]` — remote kickstart (answers via flags/prompts, preview table, confirm)
- `facility upgrade <project> [--to <version>]`
- `facility keys issue|revoke|list`
- `facility llm-requests list [--project <id>] [--from <iso>] [--to <iso>] [--limit <n>] [--cursor <iso>]`
- `facility llm-requests get <id>` — export the stored request/response envelope; use `--json` to include row metadata and envelope together.
- Existing `init|add|doctor` untouched (vendored lane).
Output: human tables by default (respect the existing ui.mjs aesthetic — mono, accent for agent-live rows), `--json` for machines on every command. Exit codes: 0 ok, 1 error, 2 auth.

Keep the CLI testable: extract command handlers to functions taking {fetch, config, stdout}; node:test suites with a stub fetch. The e2e init tests keep passing untouched.

## Mechanical floor

```
pnpm install && pnpm build && pnpm typecheck && pnpm test && pnpm lint && node guards/run.mjs
```

Tests: MCP — spin the real server (stdio transport, in-proc) against a stubbed SDK layer: tools/list golden (names+schemas), read tool happy path, write tool without token returns requires_confirmation and performs NOTHING (stub asserts no call), with tampered token rejects, with valid token executes; HTTP transport auth 401 without key. CLI — login writes 0600 config; status/runs/inbox render against stub fetch fixtures; --json emits parseable output; steer/decide send exact bodies; non-2xx maps to exit 1 with the API's error message (not a stack trace).

## Judgment criteria

Tool descriptions read like a good API doc (an LLM must pick correctly among ~25 tools); no tool bypasses confirmation; CLI stays zero-dep and its existing UX voice; config never logged; every write path lands in the platform audit (verify one in a test via stub assertion of the API call, the API side already audits).
