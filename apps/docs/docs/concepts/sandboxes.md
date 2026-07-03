---
title: Sandboxes & sessions
---

# Sandboxes & sessions

Platform-lane agents execute in **disposable, isolated sandboxes** — never on
the control plane, never on your laptop.

## Profiles

A sandbox profile declares the world an agent wakes up in: base image,
dependencies, provision command, resource limits, network posture. Profiles
are versioned and reusable; the default profile runs the platform's runner
image with your project's provision command. The provisioned-site rule is
enforced: if provisioning fails, the agent never starts — a partial
environment produces hedging, not work.

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
