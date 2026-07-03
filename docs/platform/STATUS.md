# Facility Platform — delivery status

**Branch**: `feat/platform-v0.3` (local, unpushed) · **as of** 2026-07-03

This is the honest state of the platform build against [GOAL.md](../../GOAL.md).
Nothing here is curated for a slide.

## What was built

The v0.2 CLI installer became the **control plane for the AI SDLC** — a
self-hostable TypeScript monorepo (pnpm + Turborepo) that governs identity,
money, knowledge, execution, and the two human gates across an organization's
projects.

| area | package/service | state |
|---|---|---|
| Domain logic | `@facility/core` | permissions + wildcard RBAC, price table (dated-model aware), sealed-box crypto + argon2 keys + HMAC confirmations, `facility.run.v1` receipts (tam-os superset), fingerprints, audit hash chain, render/detect ports · **tested** |
| Data | `@facility/db` | Drizzle schema (30+ tables), migrations 0001–0004 (ordered runner), org-scoped helpers, hash-chained audit, idempotent seed · **tested** |
| Control plane | `@facility/api` (Fastify 5) | session + API-key auth, WorkOS AuthKit hooks, RBAC preHandler + startup assertion, auto-audit, 70+ v1 routes, SSE run streams, HITL ledger, KB DAG validation, internal runner API, GitHub webhooks, watchtower + learning workers · **tested** |
| LLM gateway | `@facility/gateway` | Anthropic/OpenAI/BYO proxy, virtual keys, budgets (soft/hard), zero-copy streaming with usage tee, metering, envelopes · **tested + verified live** |
| Sandboxes | `@facility/api` sandbox + `runner/` | driver seam (Docker + honest AWS stub), run lifecycle, runner-token internal API, live session streaming + steering, engine parsers (Claude/Codex/BYO) · **tested + docker e2e** |
| GitHub App | `@facility/api` github | HMAC webhooks, trigger router, server-side kickstart (byte-compatible render), fingerprints + adopt, upgrade PRs, default-branch-refusing octokit wrapper · **tested** |
| Registry | control plane | skills/rules/contracts/harnesses/guards/templates, versioned + publish-immutable, bundled seed · **tested** |
| Watchtower | `@facility/api` watchtower | outcomes/health/canary/analytics, monitor-independent, incident issues · **tested** |
| HITL inbox | control plane + web | action types + resolvers + append-only ledger (AUTO-202) · **tested** |
| Knowledge / PO / learning | `@facility/harness` | Limina-style chains, write-time validation, PO + learning contracts (bundled), task propose→approve→issue, no auto-apply · **tested** |
| MCP + CLI | `@facility/mcp`, `@theam/facility` | confirmation-gated tools (stdio + HTTP), platform CLI commands · **tested** |
| Web | `@facility/web` (Next 16) | TAM-50 design system, all surfaces (overview, projects+kickstart, runs+live steer, inbox, registry, analytics, audit, settings mgmt), responsive · **verified in browser** |
| Docs | `@facility/docs` (Docusaurus) | concepts, self-host, guides, reference — TAM-50 skinned · **builds + verified** |
| Infra | `infra/` | Dockerfiles (build + run verified), docker-compose self-host, AWS Terraform · **plan-validated on the live account** |

## Verification performed

- **Full test suite green**: ~70 tests across core/db/api/gateway/mcp/runner/
  harness/cli, real Postgres; lint (Biome) clean; guards pass.
- **Money path, live**: minted a project virtual key via the API, proxied a
  real `claude-haiku` completion through the gateway, confirmed it metered into
  `llm_requests` with resolved cost.
- **Sandbox e2e**: a real Docker container ran an agent loop (hello → provision
  → events → steer → checks → result) and was reconciled/destroyed.
- **Web + docs**: driven in a browser end-to-end (login → overview → audit →
  settings), rendering seeded data in the TAM-50 brand.
- **Self-host**: the `api` image builds from the root Dockerfile and
  health-checks green in a container against Postgres.
- **AWS**: `terraform validate` + a real `terraform plan` (clean, 89 resources)
  against account 746486153337.
- **tam-os**: kickstart renders its native 44-file asset set for its real config.

## The GOAL.md checklist

Every capability the goal named, and where it lives — see
[PRD.md](PRD.md) §4 and [ARCHITECTURE.md](ARCHITECTURE.md). All are implemented;
the deliberate v1 scope notes are in ARCHITECTURE §8.

## Human-gated — intentionally NOT automated

These are outward, stateful, or accountability-bearing actions that belong to
the platform owner, not an agent:

1. **Registering the Facility GitHub App** in the theam org and installing it on
   repositories.
2. **The tam-os production cutover** — validate against a mirror repo first;
   the cutover PRs are reviewed and merged by the tam-os team. Never push to
   theam/tam-os without Adrián.
3. **A live AWS apply** — the Terraform is plan-validated; `terraform apply`
   stands up ~89 billed resources and is a cost decision for the owner.
4. **Pushing this branch / opening the PR** — the work is committed locally on
   `feat/platform-v0.3`, awaiting your review.

## Known follow-ups (tracked, non-blocking)

- Production WorkOS callback exchange is stubbed (dev-login + AuthKit redirect
  work); finish the token exchange for a production SSO deploy.
- Sandbox hardening: enforce the profile's network egress and add
  cap-drop/readonly-rootfs on the Docker driver (Fargate enforces via SG).
- `cost_cents` is integer — accurate for real agent runs; store sub-cent
  precision only if fine-grained tiny-call attribution is needed.
- Per-run receipts/pattern-miner deeper engine integration (the v0.2 roadmap
  items) remain roadmap.
