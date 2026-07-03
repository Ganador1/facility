# Spec: multi-tenancy + authorization hardening (services/api/src/routes/v1.ts + executors.ts + learning.ts + watchtower/canary.ts + github/kickstart.ts)

An adversarial review found a critical privilege escalation and multiple
high-severity cross-project/cross-org authorization holes. Fix ALL of them.
Do not weaken any test. The control plane is Fastify + Drizzle; `principal(request)`
returns `{type, id, orgId, projectId?, permissions}`. Every fix must keep the
existing green tests green and follow existing route patterns.

## Shared helpers to add near the top of registerV1Routes (after `principal`)

1. `assertProjectScope(p, projectId)` — throws `ApiError(404,"not_found","Project not found")` if `p.projectId` is set and `!== projectId`. Use everywhere a projectId is taken from a param, body, or query, and everywhere a bare-id resource resolves to a project.

2. `assertRoleAssignable(db, p, roleId)` — loads the role; throws `ApiError(400,"invalid_role")` if it doesn't exist; throws `ApiError(403,"role_not_in_org")` if `role.orgId` is non-null and `!== p.orgId`; **and enforces privilege non-escalation**: the role's permission set must be a subset of the caller's grants per `@facility/core` `can()` — for every perm in the role, `can(p.permissions, perm)` must be true, else `ApiError(403,"privilege_escalation","Cannot issue a key more privileged than yourself")`. Bundled roles (orgId null) are allowed only if they pass the subset check. (Owner with `*` can issue anything; a maintainer cannot mint an owner key.)

## Findings to fix

1. **CRIT — key issuance privilege escalation** (`POST /v1/keys` ~line 303, `POST /v1/projects/:projectId/virtual-keys` ~1036). Call `assertRoleAssignable(db, p, body.roleId)` before inserting. Virtual keys don't take a role but DO take projectId from the path — call `assertProjectScope(p, projectId)`.

2. **HIGH — project-scope only enforced on `:projectId` param routes.** Apply `assertProjectScope(p, projectId)` in every handler that receives a projectId via param/body/query, AND filter list endpoints by the principal's project when `p.projectId` is set. Affected: `/v1/keys` (list + issue — a project-scoped key must only see/issue keys for its project: filter `apiKeys` list by `projectId` when `p.projectId` set, and force issued key's projectId to `p.projectId` when set), `/v1/inbox`, `/v1/proposals` (list + create — scope by project when set), `/v1/issues` (list), `/v1/spend`, `/v1/analytics*`, KB entry list/create, task list/create/transition. For bare-id GET/mutate routes (proposal, issue, task, kb entry, key), after loading the row, `assertProjectScope(p, row.projectId)` (skip if the row has no projectId, e.g. org-scoped).

3. **HIGH — `/:projectId/.../:id` writes validate the path project then update by org+id only.** For every write to a project-owned table (poTasks, kbEntries, virtualKeys, agentDefs, and any `/:projectId/.../:id`), include `eq(table.projectId, projectId)` (the PATH projectId) in the WHERE, so a caller cannot pass another project's id under their own project path. Lines flagged: ~1156,1160,2008,2016,2031,2037,2369,2372 and the task-transition route.

4. **HIGH — HITL decide re-executes / approves expired.** In `POST /v1/proposals/:proposalId/decide`: wrap in a transaction; update the proposal ONLY with a guarded WHERE `id = :id AND org = :org AND state = 'open' AND (expires_at IS NULL OR expires_at > now())` returning the row; if no row updated → `ApiError(409,"not_open","Proposal is not open")`. Only run the executor when this guarded transition actually flipped state to approved (idempotent — a second decide is a 409, never a re-execute). Append the ledger event inside the same tx.

5. **HIGH — task_creation executor targets a guessed task cross-project.** In executors.ts, for task_creation: validate the payload against the action-type's `payload_schema`; load the target task and enforce `task.orgId === proposal.orgId && task.projectId === proposal.projectId` before updating; remove any repo fallback drawn from arbitrary payload — use the project/task's own repo. If ownership fails → throw (execution_failed ledger event).

6. **HIGH — run trigger accepts arbitrary agentDefId.** In `POST /v1/projects/:projectId/runs` (~763) and `buildRunBundle`/`dispatchRun`: after loading the agentDef, enforce `agent.orgId === run.orgId && agent.projectId === run.projectId`; reject with `ApiError(400,"agent_not_in_project")` at trigger time (and defensively in dispatch). Also `assertProjectScope(p, projectId)`.

7. **HIGH — PATCH routes spread `AnyObject` into `.set()` (mass assignment).** Replace every `body: AnyObject` (or `.optional()`) on PATCH/POST that spreads into `.update().set(...)` or `.insert().values(...)` with an EXPLICIT zod object listing only the mutable fields, and map fields manually — never spread request bodies into `.set()`. Forbidden to ever set: id, orgId, projectId, spaceId, permissions (except the dedicated roles route which sets permissions intentionally), hash, prefix, createdBy, foreign keys. Flagged: ~1215,1223 (kb entry patch),1849,1892,2004,2012 (agent def / sandbox profile / task patch),2361,2371. Audit each PATCH/PUT in v1.ts.

8. **MED — learning packet run events cross-project.** In learning.ts (~40/44/83): select run events only for the day's runs OF THIS PROJECT — filter `runEvents` by `inArray(runEvents.runId, dayRunIds)` where dayRunIds are the project's runs, not org+date.

9. **MED — platform canary self-attests via platform fields.** In watchtower/canary.ts: the platform-lane canary currently passes on `runs.status/receipt/gh` (data the runner itself writes) — that violates monitor independence. Either verify the canary outcome from independent GitHub evidence (PR/workflow/comment via the App client), or if no GitHub evidence is available, do NOT let a self-attested platform run clear/whitelist the canary health signal: treat "no independent evidence" as inconclusive (not pass), and exclude self-attested success from the health-red calculation. Add a clear comment. Keep the repo-lane canary (which reads the GitHub workflow) as the independent path.

10. **MED — adopt fingerprints with empty manifest disables drift.** In github/kickstart.ts adopt (~247): if there is no existing platform manifest AND the repo has none of the managed paths, reject adopt with a clear error (`ApiError(400,"nothing_to_adopt")`) rather than storing an empty manifest + status ok. If managed Facility paths exist in the repo, adopt those explicitly.

11. **MED — kb_amendment executor bypasses KB validation.** In executors.ts (~212): route approved kb_amendment writes through the SAME normalize+validate path as `POST /v1/projects/:projectId/kb/entries` (harness.validate + link/number normalization), rejecting invalid amendments instead of directly inserting arbitrary frontmatter/body/number.

## Mechanical floor (all must pass)

```
pnpm --filter @facility/api build && pnpm --filter @facility/api exec tsc --noEmit
DATABASE_URL=postgres://facility:facility@localhost:5461/facility pnpm --filter @facility/api test
pnpm exec biome check services/api
node guards/run.mjs
```

Add regression tests to services/api/test/api.test.ts proving: (a) a viewer/maintainer key with keys:issue cannot mint an owner-role key (403 privilege_escalation); (b) a project-scoped key cannot read/mutate another project's proposal/task/key (404); (c) deciding an already-approved proposal is a 409 and does not re-execute; (d) a PATCH cannot change a row's projectId/orgId (ignored/rejected); (e) triggering a run with an agentDef from another project is rejected.

## Judgment criteria (my review)

Every finding closed with the exact scoping in the WHERE clause (I will grep for `.set(` and `.update(` and `.values(` spreads of request bodies — there must be none); no list endpoint returns cross-project rows for a project-scoped key; HITL decide is idempotent and transactional; executors enforce org+project ownership; no test weakened. Output: file summary, floor output verbatim, per-finding note, open questions.
