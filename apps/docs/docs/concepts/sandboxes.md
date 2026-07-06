---
title: Sandboxes & sessions
---

# Sandboxes & sessions

Platform-lane agents execute in **disposable, isolated sandboxes** — never on
the control plane, never on your laptop.

## Profiles

A sandbox profile declares the world an agent wakes up in: base image,
dependencies, provision command, resource limits, network posture. Profiles
are versioned and reusable; the seeded default profile runs the platform's
runner image with your project's provision command. The provisioned-site rule
is enforced: if provisioning fails, the agent never starts — a partial
environment produces hedging, not work.

:::note The runner image & driver
A **platform-lane** run (Claude Code, Codex) needs a sandbox profile whose
**driver matches the deployment** and that can run the Facility runner:

- **docker** (local/self-host) — the profile's image entrypoint must be the
  runner. Build it with `docker build -t facility-runner:dev runner/` and set
  `FACILITY_RUNNER_IMAGE` (default `facility-runner:dev`). A bare base image like
  `node:22-bookworm` only supports **BYO-command** runs.
- **aws** (Fargate) — the runner comes from the AWS runner task definition; set
  `FACILITY_SANDBOX_DRIVER=aws` so the seeded default profile uses that driver.

`facility doctor` **fails** its `sandbox_runner` check when no profile matches
the deployment's driver (and, for docker, the runner image), so a false-ready
deployment surfaces before the first run. For the docker driver the check also
probes the Docker daemon — but it runs in the **api** task, so give the **worker**
(which actually launches sandboxes) the same Docker socket access; the api-side
probe is a readiness proxy for the worker, exactly as the object-store check is.
:::

## Drivers

Execution is driver-based: local Docker for development and self-hosting,
AWS Fargate for cloud, with the driver interface open for Kubernetes jobs.
The control plane sees one contract: launch, status, stop, destroy.

## What's inside (and what isn't)

Inside the sandbox: the repo checkout, the agent CLI (Claude Code, Codex, or
your own), the operating contract, the project's skills, and a **run-scoped
virtual key** whose only power is calling models through the gateway. Not
inside: provider API keys, GitHub App credentials, platform secrets. The
runner authenticates back to the platform with a one-time token and fetches
exactly what the run needs.

## Live sessions & steering

Every run streams structured events — status, tool use, checks, output — to
the platform. Open any run to watch it live or replay it later. When an agent
is stuck, an engineer can **steer**: send it a message from the run view, on
the record. Steering is delivered into the agent's session, marked in the
transcript, and written to the audit log. Diagnosing a wedged session no
longer means SSH and guesswork.
