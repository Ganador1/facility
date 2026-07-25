# Engineering instructions

## Critical-change regression coverage

Changes to security- or money-critical surfaces—including authentication, authorization/RBAC, tenant scoping, secrets and cryptography, billing or budget enforcement, webhook signature validation, and privileged external integrations—are incomplete without both unit tests and integration tests.

Integration tests must use deterministic fakes or local servers for external systems. The default CI suite must not need live credentials or network access. Cover successful operation and relevant denial paths, including malformed, expired, revoked, replayed, and cross-tenant inputs. Add a regression test that would fail if the previous unsafe behavior returned.
