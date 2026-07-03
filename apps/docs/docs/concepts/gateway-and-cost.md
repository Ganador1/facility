---
title: Gateway & cost
---

# The gateway: keys, budgets, cost

Every model call — Anthropic, OpenAI, or your own OpenAI-compatible endpoint
— routes through the Facility gateway. Point `ANTHROPIC_BASE_URL` or
`OPENAI_BASE_URL` at it and the official SDKs work unchanged.

## Virtual keys

Provider credentials are stored once, sealed, at the organization level.
Nothing downstream ever sees them. Projects and runs get **virtual keys**:
scoped, revocable, budget-linked, model-restricted. A run's key dies with the
run.

## Budgets

Budgets attach at org, project, or agent level, per day, week, or month —
**soft** (warn and record) or **hard** (the gateway refuses the call with a
clear error naming the budget and the override path). Enforcement happens at
request time, not in a nightly report after the money is gone.

## Attribution

Every request is metered — tokens, cost, latency — and tagged with its
project, agent, and run. Cost by model, by agent, by task is a query, not an
estimate. Spend appears in analytics in near-real-time.

## Audit

By default the gateway stores the full request/response envelope (bodies in
object storage, metadata in Postgres), access-controlled and retained per
org policy. Receipts and analytics stay metrics-only — the envelope store is
the deliberate, governed exception that makes "what exactly did the agent
send?" answerable.
