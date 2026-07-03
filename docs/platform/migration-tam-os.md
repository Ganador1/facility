# tam-os migration plan (tenant #1)

**Goal**: theam/tam-os operates 100% on the Facility platform while its
production SDLC keeps working throughout. Migration is additive, reversible,
and human-gated — never a big-bang cutover. Source of truth for what tam-os
runs today: [discovery/tam-os.md](discovery/tam-os.md).

## Principle: two lanes, flip one trigger at a time

tam-os keeps its 16 vendored workflows (`repo` lane). The platform adds value
alongside, then absorbs responsibilities one at a time (`platform` lane), each
flip reversible by a one-line project setting. At no point is tam-os's dev
process down.

## Phase 0 — import (no behavior change)

1. Install the Facility GitHub App on theam/tam-os (own-environment App).
2. Create project `tam-os`, connect the repo. Detection reads the repo:
   pnpm, Supabase, Playwright, 16 workflows → project settings prefilled
   (default branch `main`, provision `pnpm run local:setup:ui`, checks =
   the `pnpm verify` set).
3. **Adopt** the current vendored facility files as the fingerprint baseline
   (integrity from reality, not an ideal) — drift detection starts clean.
4. Register tam-os's `.claude/` skills, agents, and the operating contracts as
   project-scope registry items (still vendored in-repo for the repo lane).
Outcome: tam-os visible in the platform (repos, fingerprint ok, registry
mirrored). Zero execution change.

## Phase 1 — money (highest value, lowest risk)

1. Add tam-os's Anthropic + OpenAI keys as org-sealed provider credentials.
2. Issue a project virtual key; set `ANTHROPIC_BASE_URL`/`OPENAI_BASE_URL` in
   the crew workflow envs (`claude.yml`, `codex.yml`) to the gateway; swap the
   provider key for the virtual key. Test-tier keys stay spend-capped.
3. Port `lib/agent-sdlc/cost-budgets.ts` values into platform budgets
   (architect 150/30, builder 400/60, review 150/10, address_review 100/25,
   ci_doctor 75/25, security_sweep 50/25 — weekly/per-run USD → cents).
Outcome: every tam-os model call audited, metered, attributed, budget-enforced
at the gateway. Same agents, same workflows. Reversible by reverting the env.

## Phase 2 — telemetry

1. Point the receipt collector's sink at the platform ingest endpoint. The
   platform's `facility.run.v1` is a superset of `tam-os.agent_sdlc.run.v1`
   (`parseTamOsReceipt` maps it) — existing collectors keep emitting; PostHog
   sink stays as long as wanted.
2. Enable the platform watchtower for the project (outcomes/health/analytics).
   Monitor independence preserved (GitHub API, not platform telemetry). The
   vendored `agent-sdlc-outcomes.yml`/`sdlc-health.yml`/`agent-canary.yml`
   keep running until Phase 4 — belt and suspenders during migration.
Outcome: acceptance / one-shot / cost visible per-project on the platform,
cross-checked against the still-running vendored watchtower.

## Phase 3 — knowledge base + Project Owner (the missing `agent-kb`)

tam-os reserved `tam-os:kb-full-access` for a planned `agent-kb` service that
was never built — the platform's KB + PO agent **is** that service.
1. Seed the `tam-os` KB space from the automation-expert mission (charter from
   `kb/mission/CHALLENGE.md`, active state, existing H/E/F artifacts imported
   as the research chain; or the product chain for forward work). Import via
   the KB API preserving frontmatter + links (validator enforces on write).
2. Enable the Project Owner agent (product chain): it maintains the KB and
   proposes tasks → HITL inbox → approved tasks become GitHub issues on
   tam-os with a `## KB trace`, placed on org project #21 (the board tam-os
   already uses), WSJF-scored.
3. Enable learning mode nightly.
Outcome: the automation-expert workflow runs natively on the platform,
sandboxed, gated — the origin of this whole initiative, made first-class.

## Phase 4 — execution lanes (the actual cutover)

Per trigger, flip `execution_lane: repo → platform` and retire the vendored
twin, in this order (safest first):
1. security sweep (weekly, read-only) → platform sandbox.
2. canary → platform canary (or keep verifying the repo canary).
3. doctor (bounded repair).
4. reviewer / addresser.
5. architect, then builder (the crown jewels — last, after the rest has proven
   itself for a full cycle).
Each flip is a reviewed PR by the tam-os team (removes the vendored workflow,
sets the lane). The platform prepares the PR; **people decide**. Fallback is
always `git revert`.

## Regression guardrails (from the tam-os fragile list)

The platform must preserve, and the migration must verify, each of these
before the corresponding flip:
- App-identity pushes (GITHUB_TOKEN pushes trigger no CI) — the sandbox runner
  pushes via the installation token.
- Canary message-hash authorization (never downgrade to sender trust).
- Digest-pinned trusted-collector property (runner owns receipts, outside the
  agent's write reach).
- Provisioned-site guarantee: `pnpm run local:setup:ui` (local Supabase + 138
  migrations + seeds + Playwright) runs to completion in the sandbox BEFORE
  the agent starts — this is the single highest-risk item; the sandbox profile
  must reproduce it exactly.
- Split Supabase topology + Railway worker env namespaces (app DB vs storage
  project vs `DB_SUPABASE_*`).
- `.claude/hooks` mechanical guards for local sessions (unchanged — repo-local).
- Preview-branch TPA registration + staging migration sync (Supabase Branching
  gaps — repo-lane workflows retain these; platform previews must re-solve if
  platform-lane previews are introduced).

## Validation (before any production flip)

1. Create a private **mirror** repo (`theam/tam-os-facility-mirror`) from a
   tam-os snapshot. Run Phases 0–4 there end to end.
2. Fire a real `/architect` then `/builder` on a seeded issue in the mirror via
   the platform lane; confirm: provisioned site came up, checks ran, PR opened
   via App identity, receipt captured, budget metered, outcome collected,
   session watchable + steerable.
3. Diff platform watchtower numbers against the vendored watchtower for the
   same PRs — they must agree.
4. Only then prepare the production cutover PRs on theam/tam-os, for the tam-os
   team to review and merge. **Never push to theam/tam-os without Adrián.**

## Definition of "100% on the platform"

tam-os's architect, builder, reviewer, addresser, doctor, sweep, canary all
run platform-lane; keys/budgets/receipts/outcomes/KB/PO all platform-native;
the vendored workflows removed; the dev process (issue → /architect → gate →
/builder → review → gate → merge) unchanged for the humans using it.

## Validation status (2026-07-03)

What is proven now, locally:
- **Kickstart render is tam-os-native.** The platform's server-side renderer
  (`@facility/core` `renderFacilityInit`, a byte-compatible port of the v0.2
  installer — proven by a byte-for-byte test against the real CLI) produces the
  full 44-file asset set for tam-os's actual config (pnpm; provision
  `pnpm run local:setup:ui`; checks typecheck/lint/mcp:test/rls:check; modules
  database + analytics + design-system): crew/review/doctor/sweep/watchtower
  workflows, the database module's migration-immutability + version guards
  (tam-os has 138 migrations), the analytics/design/data-security reviewers
  (matching tam-os's telemetry-privacy, TAM-100 UI, and RLS conventions),
  skills, STANDARD.md, `.agents/skills` symlink, `.facility.json`.
- **The native capabilities exist and are tested**: gateway virtual keys +
  budgets (money path verified live), watchtower outcomes/health/canary,
  KB + Project Owner + learning harness, MCP/CLI, receipts ingest
  (`facility.run.v1` ⊇ `tam-os.agent_sdlc.run.v1`).

What remains human-gated (must NOT be automated):
- Registering the Facility GitHub App in the theam org and installing it on
  theam/tam-os — an outward, org-level action the platform owner performs.
- The production cutover PRs on theam/tam-os — reviewed and merged by the
  tam-os team. The platform prepares them; **people decide** (and the merge is
  gate 2). Validate the full Phase 0–4 loop against a private
  `tam-os-facility-mirror` first, per the phases above.
