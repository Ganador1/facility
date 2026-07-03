# Spec: harness runtime — PO agent + learning mode (packages/harness + api wiring)

**Scope**: productize the Limina pattern (discovery/limina.md) as platform machinery: KB write-time enforcement (already partly in the control plane's KB routes — this chunk completes it to the full Limina semantics), the session protocol bundle the runner mounts for harness-driven agents, the PO and learning agent definitions as bundled registry content, and the learning pipeline (nightly cron → sandbox → proposals).

Read first: discovery/limina.md (§session protocol, §enforcement, §PO adaptation — binding), discovery/automation-expert.md (KB conventions, WSJF, board rules), specs/contracts/po-agent.md + learning-agent.md (bundled contracts — copy VERBATIM into packages/harness/contracts/ and seed as registry items; do not edit their prose), sandboxes.md (bundle mechanics), control-plane.md (kb_* tables, po_tasks, proposals).

## packages/harness (`@facility/harness`)

Pure TS library used by api (validation) and runner (session protocol):

1. `chain.ts` — artifact chain config type + the two bundled chains:
   - `research` (Limina compat): H→E→F, L free, CR targets any, SR→CR.
   - `product` (PO): S free, D requires ≥1 S link, T requires D, V requires T. Frontmatter schemas per type (zod): shared {id, aliases, type, created, tags}; S {source, evidence_refs}; D {status: proposed|decided|superseded, decided_by?}; T {status: draft|proposed|created|in_progress|done|rejected, wsjf {value,time,risk,effort}}; V {task, outcome: verified|unverified|regressed, refs}.
2. `validate.ts` — full port of kb_validate semantics over DB rows (control-plane KB routes call this — refactor them onto it): frontmatter schema by chain, aliases contain own id, `## Links` section present with real refs, bidirectional link enforcement, parent-chain rule, id/slug/number consistency, ACTIVE/CHARTER specials validated on required headings. Single-entry mode (fast, on write) + full-space mode (report {errors[], warnings[]}).
3. `provenance.ts` — advisory pass: superseded refs, stale entries (configurable age per type), multi-V-per-T anomalies.
4. `session.ts` — builds the **harness bundle fragment** the runner mounts for harness agents: SESSION.md (session recovery protocol text — port Limina's, parameterized by chain), CHARTER + ACTIVE content, tool notes (how to call the platform KB/task APIs with the run's key: base URL + endpoints cheat sheet). The runner already mounts contract+skills; this adds `harness/` dir to the bundle.
5. `wsjf.ts` — score = (value+time+risk)/effort, rounding, ranking helper.

## API wiring (in `@facility/api`)

- Refactor KB routes onto harness.validate (feature-parity + the missing pieces: link bidirectionality repair on create like kb_new_artifact — auto-insert backlink into parent + ACTIVE; number allocation already there).
- `POST /v1/projects/:id/kb/entries` gains `?dry=1` (validate only) for agent preflight.
- Stop-gate endpoint: `POST /v1/runs/:id/kb-checkpoint` (runner-token): full-space validation; failures returned; the runner refuses to post terminal `result: succeeded` for harness runs while checkpoint fails (wire into runner result flow).
- Task emission: `POST /v1/tasks/:taskId/propose` → HITL proposal (action_type `task_creation`, payload = task content + WSJF + target repo); on approve → executor creates the GitHub issue via App (KB trace section, labels, board add via GraphQL when project.board configured) and flips task status created, records gh refs. (Executor lands here; App client exists from the github-app chunk — if that chunk hasn't merged yet, put the executor behind the integration seam and test with the mocked client.)
- Learning pipeline: `learning.nightly` cron per enabled project → assemble the day's material (runs, receipts refs, review summaries via App, HITL outcomes) into a **learning packet** (object storage, JSON + md digest) → create run with the learning agent_def (sandbox), bundle includes packet URL → agent posts proposals via `POST /v1/proposals` (action types: `skill_proposal`, `rule_proposal`, `guard_candidate`, `kb_amendment`, each with payload schema incl. full content + evidence refs) → approval executors: skill/rule → registry draft version created (+optional auto-publish flag off by default); guard_candidate → platform_issue kind learning (tracked, human implements); kb_amendment → KB entry draft.
- Seeds: agent_defs bundled per project on creation (disabled by default, enable via UI/API): `project-owner` (contract: po-agent, chain product, schedule daily 06:00 UTC + manual), `learning` (contract: learning-agent, nightly 03:00 UTC). Sandbox profile default docker.

## Bundled registry content

packages/harness/contracts/{po-agent.md, learning-agent.md} (verbatim copies), seeded as registry items kind agent_contract scope bundled (idempotent, content-hash keyed). Also seed harness chain configs as items kind harness (`product-chain`, `research-chain`, content = JSON of chain config).

## Mechanical floor

```
pnpm install && pnpm build && pnpm typecheck && pnpm test && pnpm lint && node guards/run.mjs
```

Tests: chain validation matrix (every rule: missing parent, missing backlink, alias mismatch, bad frontmatter per type — assert exact error codes); auto-backlink on create (parent + ACTIVE updated atomically); dry-run validates without writing; checkpoint blocks succeeded result (integration with runner result flow — simulate via internal API); WSJF math; task propose→approve→issue-created flow with mocked App client (KB trace body golden); learning packet assembly (fixture day → packet shape), proposal action-type schemas reject malformed payloads; seeds idempotent.

## Judgment criteria

Limina semantics preserved where they matter (narrow ACTIVE, session recovery text, blocking validation) — I will diff SESSION.md's protocol against the dossier; contracts seeded byte-identical to the authored files; no learning auto-apply path exists (grep: every executor requires an approved proposal event); the day the KB validator and the runner disagree about "valid", the write path wins (single source: harness.validate).
