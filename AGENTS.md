# Engineering instructions

## Critical-change regression coverage

Changes to security- or money-critical surfaces—including authentication, authorization/RBAC, tenant scoping, secrets and cryptography, billing or budget enforcement, webhook signature validation, and privileged external integrations—are incomplete without both unit tests and integration tests.

Integration tests must use deterministic fakes or local servers for external systems. The default CI suite must not need live credentials or network access. Cover successful operation and relevant denial paths, including malformed, expired, revoked, replayed, and cross-tenant inputs. Add a regression test that would fail if the previous unsafe behavior returned.

## Commit subjects set the released version

Write every commit subject as a [Conventional Commit](https://www.conventionalcommits.org/):

```text
<type>[(scope)][!]: <what changed>
```

Use one of these types: `feat`, `fix`, `perf`, `docs`, `style`, `refactor`,
`test`, `build`, `ci`, `chore`, or `revert`.

This is not a style preference. Release-on-merge derives the next version from
the subjects merged since the last release. Subject validation lands before
that workflow so the history it will consume is already trustworthy: a subject
that lies about the kind of change ships the wrong version number to everyone
who installed the package.

| Subject | What it releases while the version is `0.x` |
|---|---|
| `fix: …`, `perf: …`, `revert: …` | a patch |
| `feat: …` | a patch |
| `<type>!: …`, or a `BREAKING CHANGE:` footer | a minor |
| `docs: …`, `test: …`, `refactor: …`, `ci: …`, `chore: …`, `build: …`, `style: …` | nothing on its own |

Two consequences worth internalising:

- **A user-visible change hidden behind `chore:` never reaches users.** It sits
  on `main` unreleased until something else triggers a release, and then ships
  unannounced in someone else's release notes.
- **A breaking change without `!` ships as a patch.** Mark it, in the subject or
  in a `BREAKING CHANGE:` footer, and say in the body what a user has to change.

The pull request title follows the same rule: it supplies the subject for a
squash merge, while merge and rebase preserve the branch's commit subjects. CI
checks the title, every non-merge commit in the pull request, and the actual
subjects landed on `main`.
