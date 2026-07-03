# Discovery dossier: theam/limina (harness anatomy → PO agent + learning mode)

*Explore-agent digest, 2026-07-03.*

## What Limina actually is

Not a runtime. A **prompt/contract + filesystem-state + hooks harness that rides on a host coding agent** (Claude Code / Codex / OpenCode). Pieces: (a) `AGENTS.md` shared runtime contract (+ tiny `CLAUDE.md` adapter), (b) `kb/` as durable memory, (c) Python/shell scripts for create/validate/ID, (d) Claude Code hooks for mechanical enforcement. Long-running execution delegates to the host's continuation mechanism (long session or Codex `/goal`). No scheduler in-repo.

## Session protocol (the platform harness runtime must reproduce this)

- **SessionStart hook** injects exactly two files: `kb/mission/CHALLENGE.md` (mission brief) + `kb/ACTIVE.md` (always-on state) — nothing else.
- **Session Recovery**: read CHALLENGE → ACTIVE → open only linked artifacts → cross-check numbers/dates/decisions, disagreement = blocker → search KB before creating → proceed only when coherent.
- **ACTIVE.md is capped**: 4 fields (Objective / Next Step / Blocker / Links), **overwritten not appended** — the compaction-survival pattern.
- **Stop hook** blocks session end until full-KB validation passes (exit 2 feeds errors back to the agent).
- Working protocol: update ACTIVE whenever objective/next-step/blocker change; conclusions must land in KB, never chat-only.

## Enforcement (mechanical, not prompted)

- `PreToolUse` on Write|Edit: `enforce_hef_chain.sh` blocks creating E without existing parent H, F without parent E — parses simulated post-edit content.
- `PostToolUse`: per-file schema validation (`kb_validate.py --check-file`, fast single-file mode).
- Templates as schema-in-prose; validator tolerates YAML frontmatter AND blockquote metadata (hand-edits + generated files both validate).
- `kb_next_id.py`: filesystem-derived IDs (glob, max+1) — no counter files, self-healing.
- `kb_new_artifact.py`: renders template + **auto-inserts backlinks into parents and ACTIVE/CHALLENGE** (`add_link_to_note`); validator then enforces bidirectionality.
- `kb_provenance.py` (advisory): superseded refs, stale literature (>180d), multiple findings per hypothesis.

## Decision logic & stops

Default Research Loop: frame decision → highest-value unknown → pick ONE primary skill for the phase (skill routing is an explicit recorded decision) → H (falsifiable, mechanism, shortcut risks, **confirm/reject thresholds as literal commands, pre-registered**) → one decisive E → F (what evidence established, what improved for real, remaining debt) → update ACTIVE → CR/SR only on direction/trust changes.
Stops: validation-gated stop (hook), mission-defined `## Blocked Stop Condition` (user-authored, required at setup), devil's-advocate checkpoint verdicts (`CONTINUE|CONTINUE_WITH_FIXES|PIVOT|STOP|ESCALATE` — exactly one), negative-result taxonomy (`valid negative|invalid test|implementation failure|insufficient signal|trade-off failure` — only valid-negative licenses rejection).
Budgets: user-supplied constraints in the brief + escalation, not enforced in code (the PLATFORM will enforce real budgets — our addition).

## HITL

Ask early when missing data/access/decisions ("what's needed, why now, degraded fallback"). Escalations are **first-class KB artifacts** (CR/SR), plus live `## Blocker` in ACTIVE. Setup is a structured interview (objective, context/baseline, success criteria, resources/boundaries, blocked-stop-condition).

## Techniques to reuse verbatim in platform harnesses

1. Narrow always-on state, overwritten; everything else lazy-loaded by wikilink.
2. Mechanical enforcement trio (pre-write chain check, post-write schema check, stop-gate full validation).
3. Pre-registered confirm/reject thresholds as literal commands.
4. Negative-result taxonomy.
5. Skill-routing as explicit, recorded decision.
6. Filesystem-derived IDs; auto-backlinking on creation.
7. Anti-patterns as a first-class contract section.
8. Thin per-runtime adapters over one shared contract (AGENTS.md pattern).

## PO-agent adaptation (design directive)

- Artifact chain remap: H→E→F becomes **Signal/Need → Decision/Spec → Task → Verification** (task requires spec; verification requires shipped task w/ PR/deploy ref). Validator machinery (`validate_ref`, `required_links_for`, `validate_backlinks`) reusable as-is with a new chain config.
- CHALLENGE → PRODUCT charter (`DOMAIN.md`); ACTIVE → product state file, same 4-field cap.
- New anti-patterns: no task done without user-facing verification; shipped ≠ adopted without metric confirmation; no silent reprioritization; no speculative tasks with no linked need.
- Skills replaced: devil's-advocate → challenge product bets; experiment-rigor → requirement clarity/scope/acceptance completeness; sota-research → competitive/codebase/user-signal research (keep Now/Next/Explore/Avoid synthesis).
- **Biggest structural gap**: Limina explicitly disclaims implementation-task tracking; the PO harness promotes tasks to a first-class validator-enforced artifact wired to GitHub issues/boards (automation-expert conventions: KB trace, WSJF, forward-only board).
- Notion/Obsidian sync pattern (markdown as SoT, hash-based sync state) reusable for read-layer integrations.
