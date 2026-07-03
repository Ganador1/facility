# Discovery dossier: theam/tam-os (tenant #1 migration dossier)

*Explore-agent digest, 2026-07-03. The production system Facility generalizes. tam-os must operate 100% on the platform.*

## Stack

Next.js 15.5 App Router + React 18 + TS 5.9 · pnpm 11 workspace (`.` + `lab/`) · Supabase/Postgres (raw SQL, 138 timestamped migrations, RLS everywhere) · Vercel hosting + **Vercel Sandbox microVMs as ephemeral self-hosted GH Actions runners** for agent jobs · 3 Railway background workers (transcriptions, keyterms, executive-reports) · native macOS menu-bar app (Swift) via the same OAuth relay. Supply-chain hardening in pnpm-workspace.yaml (7-day quarantine, allowBuilds, CVE overrides).

## WorkOS auth (the pattern the platform copies)

- Packages: `@workos-inc/authkit-nextjs@4` (middleware + session cookie), `@workos-inc/node@9`, `jose` (JWKS).
- Env: `WORKOS_API_KEY`, `WORKOS_CLIENT_ID`, `WORKOS_COOKIE_PASSWORD` (32+), `NEXT_PUBLIC_WORKOS_REDIRECT_URI`, `WORKOS_AUTHKIT_DOMAIN`, optional `WORKOS_API_HOSTNAME`, `MCP_CONFIRMATION_SECRET`. Central env schema via `@t3-oss/env-nextjs` in `lib/env.ts` — every read funnels through it.
- Flow: `authkitMiddleware()` gates everything except an explicit `unauthenticatedPaths` allowlist; `app/callback/route.ts` `handleAuth()`; server-side `withAuth()` per request. Identity upstream: JumpCloud → SAML → WorkOS (authenticated ⇒ TAM employee).
- Claims: `roles` (labels, NOT used for authz) vs `permissions` (e.g. `tam-os:distribution-full-access`) — **DB/RLS reads permissions only, never role names**. Composite roles (omnimanager, leadmanager) resolve to permission sets. Portable auth kernel: `sql/tam-os-auth-kernel.sql` designed to copy into sibling services.
- Local dev/CI: self-signed HS256 JWT shim mimicking WorkOS claim shape (`SUPABASE_LOCAL_JWT_*`) so RLS is exercisable offline.
- **MCP auth = separate surface**: tam-os is its own OAuth 2.1 Authorization Server relaying to WorkOS User Management — RFC 8414 (`/.well-known/oauth-authorization-server`) + RFC 9728 (`/.well-known/oauth-protected-resource`), `/oauth/{authorize,callback,token,register}`, PKCE S256 between client↔app, confidential client app↔WorkOS, stateless sealed flow-context (cookie-password-derived). Bearer verified with `jose.jwtVerify` against remote JWKS **pinned by issuer** (Connect vs User-Mgmt tokens share keys, differ in `iss`). Proven with Claude/Cursor/ChatGPT + native macOS app. **Adopt this wholesale for the platform's MCP.**

## SDLC wiring (16 workflows, 4,661 lines)

- `claude.yml` builder-architect: `/builder` (opusplan, effort max, bypassPermissions, max-turns 1000) + `/architect` (opus-4-8) via claude-code-action SHA-pinned; runs on Vercel Sandbox runners (provision-runner → agent → cleanup-runner job triplet, `VERCEL_SANDBOX_PARITY_CONFIRMED` gate); pushes via **GitHub App token** (`CLAUDE_PUSH_APP_ID/_PRIVATE_KEY`) because GITHUB_TOKEN pushes trigger no CI; board moves via `move-project-status.sh` (org project #21, forward-only); test-tier provider keys via `claude-bot` Environment.
- `codex.yml` + `codex-issue-comment.yml` router: `/codex-builder` `/codex-architect`, Codex CLI pinned `@openai/codex@0.141.0`, gpt-5.5 xhigh, `danger-full-access` sandbox, `CODEX_AUTH_JSON_BOOTSTRAP` OAuth state, sticky progress comment from `codex exec --json` stream, own App identity. Dispatcher pattern keeps privileged triggers narrow.
- `claude-code-review.yml`: sonnet-4-6 on every PR (comments only). `claude-address-review.yml`: opus on human review of bot PRs.
- `ci-doctor.yml`: workflow_run watcher + deterministic resolver + narrow repair agent (refuses workflows/secrets/auth/RLS/migrations).
- `weekly-security-sweep.yml`: deterministic scanners (gitleaks, pnpm audit, Scorecard, alert pulls) → read-only opus audit → validated `agent-findings.json` → deduped issues.
- `agent-canary.yml` (Tue): posts pinned probe via `tam-os-bot` App; **message-hash authorization (byte-identical SHA-256, architect-only, labeled issue)** — never sender-trust.
- `agent-sdlc-outcomes.yml` (nightly): joins `claude/*`,`codex/*` PRs with fate → PostHog events. `sdlc-health.yml` (daily + weekly pattern miner): GitHub-API-only (never PostHog — monitor independence), cost check vs `lib/agent-sdlc/cost-budgets.ts`, one tracking issue, weekly `sdlc-pattern` issues (the ratchet).
- Supabase Branching support: `register-preview-tpa.yml` (TPA config doesn't propagate to preview branches) + `sync-staging-on-main.yml`. Build.yml with docs-only fast path.
- Operating contracts as separate markdown: `.github/claude/{system-prompt,architect-system-prompt,ci-doctor-system-prompt}.md`, `.github/codex/{builder,architect}-prompt.md` (UNTRUSTED REQUEST CONTEXT sentinels), `.github/security-sweep/claude-security-audit-prompt.md`.
- `AGENTS.md`/`CLAUDE.md` = near-identical twins; `.agents/skills` symlink → `.claude/skills`. No STANDARD.md — role filled by `docs/agent-quality-standard.md`. Guards at `scripts/guards/` (18, `{name, description, requires?, run()}` contract under `pnpm verify`; DB-dependent guards auto-skip via `requires`).

## .claude/ inventory

Agents: feature-quality-reviewer (opus, lead), rls-security-reviewer (opus), mcp-search-exposure-reviewer (sonnet, "AI queryability by default"), tam-100-ui-reviewer (sonnet), telemetry-privacy-reviewer (sonnet). Commands: add-telemetry, new-migration, open-pr, verify. Hooks: guard-bash.mjs (rm -rf, force-push, db reset, .env redirects), guard-files.mjs (applied-migration immutability, .env writes, storage-state), eslint-changed.mjs. settings.json: curated allow/ask/deny, `enableAllProjectMcpServers:false`.

## MCP server

Hand-rolled JSON-RPC 2.0 dispatcher at `app/api/mcp` (deliberately not SDK transports). **135 `tam_os_*` tools** in one flat registry; every write routes through the same service layer as UI/REST (guard-enforced); **write confirmation tokens**: 5-min HMAC tokens binding userId+clientId+toolName+args-hash+summary. Resources (`tam-os://me`, entity templates) + named prompts. Per-request Supabase client under caller's bearer — **no service-role escape hatch** (CI-checked). 64KB body cap, CORS allowlist (claude.ai/chatgpt.com/etc.), STRIDE threat model in `docs/mcp-security.md`, audit record per call, 80% coverage gate.

## Receipts/observability (the platform must ingest + supersede)

- Per-run receipt: schema **`tam-os.agent_sdlc.run.v1`** (Zod, `lib/agent-sdlc/schema.ts`): provider (codex_cli|claude_code), mode (architect|builder|review|address_review|ci_doctor|security_sweep), result, usage (tokens, cost_usd, cost_source), activity (turns, shell_commands, file_changes, mcp_tool_calls, errors), GitHub ctx (SHA-256-hashed actor). Artifact + PostHog events: `agent_sdlc_{run_started,run_completed,usage_reported,check_reported,outcome_reported,health_reported}` via dedicated `POSTHOG_COLLECTOR_KEY`.
- **Trusted-collector integrity**: collector source fetched from default branch (not agent worktree), digest-pinned, re-verified before execution — agent cannot tamper with its own telemetry. Platform must preserve this property.
- Self-reported checks: `.agent-sdlc/checks.jsonl`, flagged `checks_self_reported` (never verified truth).
- Privacy hard rule: never raw prompts/bodies/tool IO/transcripts; OTel **metrics-only** (`OTEL_LOGS_EXPORTER=none`, `OTEL_TRACES_EXPORTER=none`); hashed actors.
- Cost budgets as code: `lib/agent-sdlc/cost-budgets.ts` — per mode `{weeklyUsd, perRunUsd}`: architect 150/30, builder 400/60, review 150/10, address_review 100/25, ci_doctor 75/25, security_sweep 50/25.
- Dashboard: `/control` (HogQL via PostHog query API; product|health|agents views; internal traffic excluded from product numerators). Langfuse for LLM traces.

## PO-agent linkage

**None in tam-os.** `tam-os:kb-full-access` permission is reserved for a planned sibling service **`agent-kb`** (not built). `sql/tam-os-auth-kernel.sql` exists specifically so siblings adopt identical WorkOS-permission RLS. → The Facility platform's KB/PO capability IS the missing agent-kb; no tam-os code to migrate for it (workflow lives in automation-expert repo).

## Fragile things the platform must preserve (regression list for the migration)

1. App-token pushes (GITHUB_TOKEN → no CI on agent PRs — silently ships unreviewed).
2. Canary message-hash auth (never downgrade to sender trust).
3. Digest-pinned trusted collector property.
4. Vercel-Sandbox runner triplet lifecycle + parity gate (platform sandboxes replace this — must match provision guarantees: local Supabase + 138 migrations + seeds + Playwright ready BEFORE agent starts = `pnpm run local:setup:ui`).
5. Preview-branch TPA registration + staging migration sync (Supabase Branching gaps).
6. `.claude/hooks` mechanical guards for local sessions.
7. Split Supabase project topology (app DB vs storage project vs worker env namespaces).
8. Docs-only CI fast path semantics (skipped required check = satisfied).
9. Env validation central schema pattern.
10. "AI queryability by default" reviewer convention (prose-only today — candidate to become a platform guard).

## Env inventory (grouped)

Supabase (app DB + storage project + worker `DB_SUPABASE_*`), WorkOS block, LLM providers with tier overrides (`ANTHROPIC_*`, `OPENAI_*`, `SEARCH_AGENT_MODEL_PROVIDER`), observability (PostHog product + collector keys + project query API, Langfuse), Slack block, transcription stack (ElevenLabs, pyannote, ffmpeg/VMAF ladder), Notion keyterms, InkDeck reports, E2E storage states, GitHub App (feedback issues): `GITHUB_APP_ID/_PRIVATE_KEY/GITHUB_FEEDBACK_REPO`.
