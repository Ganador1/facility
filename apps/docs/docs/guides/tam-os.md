---
title: "Case: tam-os"
---

# The first tenant: tam-os

tam-os — The Agile Monkeys' internal ops platform — is where this system
grew up: 16 agent workflows, dual Claude/Codex lanes, receipts, budgets as
code, a canary that caught a real bug on its first flight. It is Facility's
first tenant and the migration that validates the platform.

## What the import maps

| tam-os today | on the platform |
|---|---|
| `claude.yml` / `codex.yml` builder-architect workflows | repo-lane triggers on the imported project (unchanged), platform-lane available per command |
| provider secrets in Environments | gateway virtual keys + org-sealed credentials |
| `lib/agent-sdlc/cost-budgets.ts` | platform budgets (same numbers, enforced at the gateway, still visible as code via the API) |
| receipt artifacts + PostHog events (`tam-os.agent_sdlc.run.v1`) | ingested natively — `facility.run.v1` is a compatible superset; PostHog sink stays as long as wanted |
| `agent-sdlc-outcomes.yml` / `sdlc-health.yml` / `agent-canary.yml` | platform watchtower per project (monitor-independence preserved); vendored versions keep running until switched off |
| `.claude/` skills, agents, commands | registry items (project scope), still vendored in-repo for the repo lane |
| the planned `agent-kb` sibling service | the platform's knowledge base + Project Owner agent, running the automation-expert mission natively |

## The rule of the migration

tam-os operates 100% throughout: every step is additive, reversible, and
human-gated. Cutover of production triggers is a reviewed PR by the tam-os
team — the platform prepares it; people decide.
