---
title: Watchtower
---

# The watchtower

An agent pipeline fails politely: a dead trigger stops summoning agents, a
mis-permissioned lane approves silence, and nothing turns red. The watchtower
is the layer that makes silence visible — platformized from the vendored
scripts, per project, with the same non-negotiable design rules:

1. **The monitor does not depend on what it monitors.** Health judgments read
   the GitHub API directly — never the telemetry the pipeline writes about
   itself.
2. **A watchtower that quietly rots is worse than none.** Watchtower failures
   raise platform issues themselves.

## The instruments

- **Outcomes** (nightly) — every terminal agent PR is joined to its linked
  issue, merger identity, merge-commit shape and policy evidence, review rounds, and human
  fixup commits. **Accepted** means a human squash-merged it; lead time runs
  from issue creation to merge. If GitHub cannot prove the merge method,
  Facility reports the outcome as unassessed instead of guessing. **One-shot**
  means merged with zero change requests and zero human fixup commits.
  Acceptance and one-shot rates are metrics, not anecdotes. Outcomes are
  telemetry and immutable run artifacts; they never create work issues.
- **Health** (daily) — failure streaks and run budgets per workflow and per
  platform agent; breaches open a single deduped issue and resolve themselves
  on recovery.
- **The canary** (weekly) — a synthetic probe through the real pipeline.
  For repo-lane projects the pinned, hash-authorized `/architect` probe is
  verified; for platform-lane projects the canary run must produce its ack
  and its receipt. Monitors tell you a workflow ran; only the canary proves
  the chain works before a human hits the breakage.

## Issues

Everything that goes wrong across the lifecycle — drift, budget breaches,
run failures, stuck sessions, guard failures, canary failures — is a
first-class platform issue with a fingerprint (deduped), a state, and a
trail. The Actions-tab glance becomes an org-wide view.

The issue boundary is deliberate. Health maintains one incident only while
the system is unhealthy. The read-only security agent emits structured
findings; trusted code creates or updates issues only for actionable,
high-confidence, high/critical findings. Receipts and outcomes remain evidence,
not backlog generators.

## How the canary is authorized

The canary is the one bot allowed to summon the crew, and it earns that with
the narrowest authorization in the system — **the message is authorized, not
the sender**:

1. The probe must be posted with a GitHub App token (`CANARY_APP_ID` /
   `CANARY_APP_PRIVATE_KEY`): comments posted with a workflow's own
   `GITHUB_TOKEN` trigger no workflows at all, so a `GITHUB_TOKEN` canary
   would test nothing (see [hardening note 14](../reference/hardening.md)).
2. `facility-crew.yml` admits that bot login only for an `issue_comment` on
   an `agent-canary`-labeled issue, resolving to `/architect` (never
   `/builder`), whose body is **byte-identical — SHA-256, CR-stripped — to
   the pinned probe** in `.github/facility/watchtower/canary.mjs`.
3. The hash in the crew workflow is generated from that same constant at
   `init` time and held in sync by the `watchtower-locked` guard.

A leaked canary App key can therefore at worst replay one fixed, read-only,
bounded-cost probe — never attacker-chosen instructions. Without the App
secrets the canary skips with a notice, and everything else keeps working.

## In the repository lane

Projects that installed the process into their own repository run the same
instruments as vendored scripts, with two differences worth knowing.

**The watchtower is locked by a guard.** A disabled schedule or a drifted
canary hash fails `node guards/run.mjs`, because a watchtower that quietly
rotted is worse than none: it keeps vouching. The monitor also stays out of
its own watchlist — nothing may depend on what it monitors.

**Budgets are a reviewed file.** `.github/facility/watchtower/budgets.json`
caps daily failures and weekly runs per workflow; a breach turns the daily
health run red and lands in the incident issue. Keeping budgets in the
repository means a budget change is a diff with an author and a reason —
"costs will run away" gets answered with a file rather than a promise.

Numbers are published where the team already lives: the dashboard issue and
the Actions tab, with no dashboard product to stand up. An optional
`WATCHTOWER_WEBHOOK_URL` repository variable also POSTs each outcomes summary
as JSON to the sink of your choice.
