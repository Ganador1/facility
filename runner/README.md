# Facility Runner

The runner boots inside a sandbox container with only `FACILITY_API_URL`, `RUN_ID`, and `RUNNER_TOKEN`.
It calls `/internal/runs/:id/hello`, fetches the signed bundle URL, writes `/work/contract.md`, mirrors skills into `.claude/skills` and `.agents/skills`, runs provisioning, launches the configured engine, streams run events, parses self-reported `.agent-sdlc/checks.jsonl`, and posts the final result.

## Steering

- `byo`: long-polls `/internal/runs/:id/steer`, appends delivered messages to `STEERING.md`, and emits a `steer` run event immediately. The BYO process can read that file.
- `claude_code`: v1 baseline records steer messages in `STEERING.md` while the current `claude -p` turn runs. After the process exits, the next implementation can replay the queued text with `claude -p --resume <session_id>` when a session id is available; this runner does not pretend stdin turn injection works for the non-interactive CLI.
- `codex`: v1 baseline records steer messages in `STEERING.md` and emits audit events. `codex exec --json` is treated as a single non-interactive turn.

