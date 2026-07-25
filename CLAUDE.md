# Claude instructions

Follow all instructions in `AGENTS.md`.

In particular, every change to authentication, authorization/RBAC, tenant isolation, secrets/cryptography, billing, webhooks, or privileged external integrations must include unit tests and deterministic integration tests that simulate external dependencies without live credentials or network access. Cover success, denial, malformed, expired, revoked, replay, and cross-tenant regression cases as applicable.
