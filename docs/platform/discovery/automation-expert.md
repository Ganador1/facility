# Discovery dossier: theam/the-agile-monkeys-automation-expert

*Explore-agent digest, 2026-07-03. Source: repo clone (Limina-harness production mission maintaining the tam-os automation KB).*

## What it is

"The persistent brain" of an autonomous research mission on the Limina harness: an agent works the mission across sessions; every hypothesis, experiment, finding, decision is written to `kb/` for auditability. Mission: map company processes, baseline automation, ship automations, weekly snapshots for leadership.

## KB anatomy (the shape the platform must support natively)

- Layout: `kb/ACTIVE.md` (single always-on state file), `kb/mission/CHALLENGE.md` (charter), `kb/mission/CEO_REQUESTS.md` (escalation ledger R-series), `kb/research/{hypotheses,experiments,findings,literature}` (`H*/E*/F*/L*.md`), `kb/reports/` (`CR*/SR*` challenge/strategic reviews), `kb/research/data/` (raw evidence, schema-exempt), `kb/lessons/`, `kb/comms/slack/` (drafted→posted outbound comms).
- Naming `{PREFIX}{NNN}-{slug}.md`, IDs allocated by scanning (`scripts/kb_next_id.py`), no counter files.
- YAML frontmatter per type; obsidian wikilinks `[[H001]]`; **bidirectional link validation** (child must link parent AND parent must link child; everything links `[[ACTIVE]]` + `[[CHALLENGE]]`).
- `supersedes` / `supersedes_framing_of` frontmatter = provenance/versioning; git history is the version store.
- Validators: `scripts/kb_validate.py` (structural, blocking), `scripts/kb_provenance.py` (staleness/superseded refs, advisory), `scripts/kb_new_artifact.py` (the only sanctioned creation path — renders template, allocates ID, wires links both ways).

## Enforcement model (hooks — the hardest primitive to replicate)

Claude Code lifecycle hooks in `.claude/settings.json` → `scripts/hooks/`:
- `SessionStart` → injects CHALLENGE.md + ACTIVE.md verbatim; opens telemetry session.
- `PreToolUse` (Write|Edit|MultiEdit) → `enforce_hef_chain.sh`: blocks creating `E*` without existing parent `H*`, `F*` without parent `E*` (DAG creation order at tool-call time, simulated post-edit content).
- `PostToolUse` → `kb_write_guard.sh`: per-file schema validation, blocking.
- `Stop` → full-tree validation; session cannot end on invalid KB.

## Task generation (KB → execution)

- Tasks are **GitHub issues in the owning service repo** (default theam/tam-os), never files in the KB repo. KB artifact frontmatter records `github:` URLs; issue body must carry `## KB trace` citing the KB id — verified bidirectional.
- All issues aggregate on **org Project board theam/#21** ("TAM OS — Agentic SDLC Backlog"); field/option IDs pinned in `scripts/data/github_config.json` (Status, Priority, Service, Epic, Jira Key).
- Board: Backlog → Planning → Ready → In Progress → In Review → Done. Agents act only in Planning (plan) and In Progress (implement); `/architect` moves to Planning, `/builder` to In Progress (shipped in tam-os#298). Other transitions human-only. PRs close issues via `Closes #n`.
- Prioritization: Priority field visible; canonical method **WSJF-lite** = (BusinessValue + TimeCriticality + RiskReduction) / Effort, in the issue `## Value` block.
- Issue-body convention: problem, file:line evidence, fix sketch, acceptance criteria; labels `type:*`, `priority:*`.
- Tooling: `gh_project_setup.py` (GraphQL board setup), `jira_github_migrate.py` (+`lib/migration.py`) reference implementation for issue shaping, `link_sub_issues.py` (native sub-issues), `verify_migration.py` (deterministic acceptance gate).

## Cadence & runtime

- No cron in-repo. Sessions launched externally (`.cook/config.json`: `{agent: claude, sandbox: agent, steps: {work, review}}`). Session recovery protocol: adapter → CHALLENGE → ACTIVE → linked artifacts → H→E→F loop.
- **Scheduler requirement** (from their own E007 evaluation): sub-hour cadence + event triggers (Slack, webhooks); Anthropic hosted Routines REJECTED (1h min cadence, 25 runs/day cap); theam/autonomy uses arq+Redis+advisory locks.
- `AGENTS.md` = runtime-agnostic shared contract; `CLAUDE.md`/`COOK.md` thin adapters (multi-engine layering pattern).
- 13 in-scope repos pinned as submodules under `tracked-repos/`.

## Human validation loop

- Escalation ledger `CEO_REQUESTS.md` (R-series, PENDING → resolved in place; agents block on PENDING).
- CR/SR artifacts for direction challenges; `research-devil-advocate` skill as playbook.
- New inputs dropped in `ACTIVE.md` "New Inputs" by named humans; agent picks up next session.
- Execution gates: task must have human owner before agent starts; plan approved by human before build; 3-way PR review (Codex + Claude + human).
- **HITL approval design (AUTO-202 / tam-os#238, resolved 2026-06-22 — the platform inbox should implement this)**: registered `action_type` (payload JSON schema) → proposal routed by `resolver_type` (`emails|permission|team|dynamic`) → inbox (web + Slack + macOS later) with `context_md` → on approval dispatched (internal handler or external webhook) → append-only event ledger `draft → open → approved/rejected/cancelled/expired` + `executed/execution_failed`.
- Outbound comms: draft → explicit human approval → send via MCP → archive with permalink (`share-merge` command).
- Telemetry: consent-gated (3-choice first-run), machine-readable allowlist contract (`telemetry/contract.v1.json`), relay boundary, never code/paths/prompts.

## Platform-native requirements distilled

1. Versioned markdown KB store with typed frontmatter, naming conventions, schema-exempt dirs.
2. **Write-time policy enforcement** in the harness runtime (pre/post tool-call validation, blocking; end-of-session full validation).
3. Deterministic artifact scaffolding (next-ID, templates, auto bidirectional links).
4. Task emission to service repos + shared board, bidirectional KB↔issue links, WSJF fields, forward-only agent transitions.
5. HITL approval service per the AUTO-202 spec (action types, resolvers, ledger, multi-channel).
6. Scheduler: cron + event triggers, sub-hour capable, per-project.
7. Session bootstrap/context injection; session recovery protocol support.
8. Escalation ledger primitive with block-until-resolved semantics.
9. Consent-gated telemetry with a machine-readable privacy contract.
10. Multi-engine contract layering (shared contract + per-runtime adapters).
