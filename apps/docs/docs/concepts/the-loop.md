---
title: The loop
---

# The loop

One change, end to end. This is the SDLC Facility installs and governs —
the same loop shown at [sdlc.theagilemonkeys.com](https://sdlc.theagilemonkeys.com).

1. **Intake.** Work begins as a signal — feedback, telemetry, a meeting, an
   alert. Signals become issues with a named human owner. The board moves
   forward only, and only on explicit human action.
2. **Planning.** `/architect` plans against reality: it reads the code and
   runs real commands in a provisioned environment. Planning happens in the
   issue thread, where it can be challenged cheaply.
3. **Human gate 1.** An engineer accepts the plan. Invoking `/builder` *is*
   the acceptance — that's why the invocation moves the board.
4. **Build.** `/builder` implements end to end in one run: code, tests,
   checks, push, PR. One-shot delivery is deliberate: an agent allowed to
   ship "foundation + plan" will ship it every time.
5. **Defense in depth.** A contract the agent cannot override, specialist
   reviewers, deterministic guards, and the full build — machines test.
6. **Human gate 2.** A person reviews and merges. Machines test; a person
   signs.
7. **Self-observation.** Every run leaves a receipt (tokens, cost, duration,
   checks). Outcomes are joined nightly, health checked daily, and a
   synthetic canary flies the whole path weekly. Recurring failures become
   new guards — **the ratchet**: the guard set only grows.

## Two execution lanes

Facility runs this loop in two ways, per project and per trigger:

- **Repo lane** — the vendored GitHub workflows installed by kickstart run
  the agents in your CI, exactly as `facility init` always did. Zero platform
  dependency at execution time.
- **Platform lane** — the platform runs the agent in its own sandbox: same
  contracts, same gates, plus live session streaming, steering, and
  platform-enforced budgets.

Migrating a repo is not a rewrite — it's flipping lanes one trigger at a
time, with the fallback always intact.
