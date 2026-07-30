# Engineering instructions

## Critical-change regression coverage

Changes to security- or money-critical surfaces—including authentication, authorization/RBAC, tenant scoping, secrets and cryptography, billing or budget enforcement, webhook signature validation, and privileged external integrations—are incomplete without both unit tests and integration tests.

Integration tests must use deterministic fakes or local servers for external systems. The default CI suite must not need live credentials or network access. Cover successful operation and relevant denial paths, including malformed, expired, revoked, replayed, and cross-tenant inputs. Add a regression test that would fail if the previous unsafe behavior returned.

## Commit subjects set the released version

Write every commit subject as a [Conventional Commit](https://www.conventionalcommits.org/):

```text
<type>[(scope)][!]: <what changed>
```

This is not a style preference. Merging to `main` releases, and the subjects
merged since the last release are what decide the version — so a subject that
lies about the kind of change ships the wrong version number to everyone who
installed the package.

| Subject | What it releases while the version is `0.x` |
|---|---|
| `fix: …`, `perf: …` | a patch |
| `feat: …` | a patch |
| `feat!: …`, or a `BREAKING CHANGE:` footer | a minor |
| `docs: …`, `test: …`, `refactor: …`, `ci: …`, `chore: …`, `build: …`, `style: …` | nothing on its own |

Two consequences worth internalising:

- **A user-visible change hidden behind `chore:` never reaches users.** It sits
  on `main` unreleased until something else triggers a release, and then ships
  unannounced in someone else's release notes.
- **A breaking change without `!` ships as a patch.** Mark it, in the subject or
  in a `BREAKING CHANGE:` footer, and say in the body what a user has to change.

The pull request title follows the same rule and is checked in CI, because a
squash merge makes that title the subject on `main`.

