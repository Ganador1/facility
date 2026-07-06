# Facility Runner

The runner boots inside a sandbox container with only `FACILITY_API_URL`, `RUN_ID`, and `RUNNER_TOKEN`.
It calls `/internal/runs/:id/hello`, fetches the signed bundle URL, writes `/work/contract.md`, mirrors skills into `.claude/skills` and `.agents/skills`, runs provisioning, launches the configured engine, streams run events, runs the platform-owned acceptance gates (`bundle.checkCmds`) and parses the agent's self-reported `.agent-sdlc/checks.jsonl`, and posts the final result.

A run **succeeds only if the engine exits 0 AND every platform check passes** — a green agent report cannot make a red gate pass. Platform checks emit `check` events with `self_reported: false`, a pass/fail `status`, an `exit_code`, and (on failure) a capped, secret-redacted output tail; the agent's self-reports are flagged `self_reported: true` (the runner forces the flag, so provenance can't be spoofed). Check commands come from the sandbox profile's `setup.check_cmds`, falling back to the project's `settings.check_cmds`.

## Steering

- `byo`: long-polls `/internal/runs/:id/steer`, appends delivered messages to `STEERING.md`, and emits a `steer` run event immediately. The BYO process can read that file.
- `claude_code`: v1 baseline records steer messages in `STEERING.md` while the current `claude -p` turn runs. After the process exits, the next implementation can replay the queued text with `claude -p --resume <session_id>` when a session id is available; this runner does not pretend stdin turn injection works for the non-interactive CLI.
- `codex`: v1 baseline records steer messages in `STEERING.md` and emits audit events. `codex exec --json` is treated as a single non-interactive turn.

