---
title: The inbox
---

# The inbox: human-in-the-loop, one place

Every decision an agent needs from a human lands in one inbox: plan
acceptances, learning-mode validations, kickstart reviews, budget overrides,
task approvals from the Project Owner agent, escalations from blocked runs.

## How it works

Facility implements the HITL model The Agile Monkeys converged on in
production (the AUTO-202 design):

- **Action types** declare what can be proposed: a JSON schema for the
  payload, a resolver for who may decide (explicit emails, a permission, a
  team, or a dynamic rule), and an executor for what approval does (an
  internal platform action, an outbound webhook, or nothing but the record).
- **Proposals** carry the evidence: a human-readable context, the exact
  payload, links to the run and project.
- **The ledger** is append-only: draft → open → approved / rejected /
  cancelled / expired, then executed or execution-failed. Who decided, when,
  and why is never reconstructable-only — it's recorded.

## Design intent

Gate actions are one tap, with the evidence inline — the plan, the diff, the
receipts. Approving dispatches the action; rejecting records the reason and
feeds it back to the proposing agent. Nothing an agent proposes executes
without the ledger saying a named human said yes.
