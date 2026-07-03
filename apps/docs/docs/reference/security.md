---
title: Security model
---

# Security model

Security and privacy are first-class concerns; this page is the contract.

## Identity & access

- Humans: WorkOS SSO (AuthKit). Machines: argon2id-hashed API keys bound to
  roles. One permission catalog for web, CLI, MCP, and agents; deny by
  default; every route declares its permission and the startup assertion
  refuses undeclared routes.
- Custom roles are named permission sets — no side-channel authority.

## Secrets

- Provider keys, GitHub App key, WorkOS credentials: sealed (libsodium) with
  a master key from your secret manager/KMS. Decrypted only in the service
  that needs them; never returned by any API; access audited.
- Sandboxes receive no provider secrets — only run-scoped virtual keys and
  short-lived repo tokens fetched after boot.

## Untrusted text

Issue, PR, review, and comment text is data, never instructions — the rule
holds in webhook handlers (no interpolation into shell/prompts/SQL), in
operating contracts, and in the rendered workflows (jq event parsing,
start-of-line slash commands, bot-refusal, message-hash canary
authorization). The fifteen production hardening notes ship encoded in
templates, handlers, and guards — not as advice.

## Audit & privacy

- Append-only, hash-chained audit log; tamper evidence is a query.
- Store-everything default (envelopes, transcripts) with per-org retention
  and access gated by permission + project scope.
- Receipts and analytics are metrics-only: no prompts, no code, hashed
  actors. Self-hosted telemetry to the vendor: none.

## The invariants that never move

Agents never approve, never merge, never push to protected branches. Every
outward action carries a named principal. Every merge carries a human
decision.

Report vulnerabilities per [SECURITY.md](https://github.com/theam/facility/blob/main/SECURITY.md).
