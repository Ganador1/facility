#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { parseClaudeStreamJsonLine, parseCodexJsonlLine } from "./parsers.js";
import type { RunBundle, RunEvent } from "./types.js";

const workRoot = "/work";
const steerFile = join(workRoot, "STEERING.md");

// Secret values injected into the run (virtual key, platform key, runner token,
// repo clone token) that must never surface in captured check output persisted to
// run_events, which any runs:read principal can read. Populated as the workspace
// is prepared; redactSecrets() scrubs them from a check's stdout/stderr tail.
const secretsToRedact = new Set<string>();

export function redactSecrets(text: string, secrets: Iterable<string> = secretsToRedact): string {
  let out = text;
  for (const secret of secrets) {
    // Length guard so a short/empty value can't over-redact; real keys/tokens are
    // long. split/join replaces every occurrence without regex-escaping the secret.
    if (secret && secret.length >= 8) out = out.split(secret).join("«redacted»");
  }
  return out;
}

async function main() {
  const startedAt = Date.now();
  let bundle: RunBundle | null = null;
  let steerStop: (() => void) | undefined;
  secretsToRedact.add(runnerToken());
  try {
    const hello = await api<Record<string, unknown>>(`/internal/runs/${currentRunId()}/hello`, {
      method: "POST",
    });
    bundle = (await fetchJson(String(hello.bundleUrl))) as RunBundle;
    await prepareWorkspace(bundle, String(hello.virtualKey), {
      platformKey: hello.platformKey ? String(hello.platformKey) : null,
      platformApiUrl: hello.platformApiUrl ? String(hello.platformApiUrl) : apiUrl(),
      projectId: hello.projectId ? String(hello.projectId) : "",
      repoToken: hello.repoToken ? String(hello.repoToken) : null,
    });
    steerStop = startSteeringPoll();
    if (bundle.provisionCmd) {
      const provision = await runShell(
        bundle.provisionCmd,
        cwdFor(bundle),
        "shell",
        bundle.timeoutMin,
      );
      if (provision !== 0) {
        await postResult("failed", startedAt, { code: "provision_failed" });
        return;
      }
    }
    const engineCode = await runEngine(bundle, startedAt);
    await emitChecks(cwdFor(bundle));
    // Platform-owned acceptance gates run independently of the engine's own
    // exit code and self-report: a run only succeeds if the engine succeeded AND
    // every configured check command passes. Skip them when the engine already
    // failed (the run fails regardless). Without this an agent could report
    // success while its required checks are red.
    const checksPassed = engineCode === 0 ? await runChecks(bundle, cwdFor(bundle)) : false;
    const succeeded = engineCode === 0 && checksPassed;
    await postResult(
      succeeded ? "succeeded" : "failed",
      startedAt,
      succeeded ? undefined : engineCode !== 0 ? { code: engineCode } : { code: "checks_failed" },
    );
  } catch (error) {
    await postResult("failed", startedAt, { error: errorMessage(error) }).catch(() => undefined);
    process.exitCode = 1;
  } finally {
    steerStop?.();
  }
}

export async function prepareWorkspace(
  bundle: RunBundle,
  virtualKey: string,
  platform: {
    platformKey: string | null;
    platformApiUrl: string;
    projectId: string;
    repoToken: string | null;
  },
  root = workRoot,
) {
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "contract.md"), bundle.contract);
  const cwd = cwdFor(bundle, root);
  if (bundle.repo.cloneUrl) {
    // Inject a token for private clones (x-access-token is how both PATs and
    // GitHub App installation tokens authenticate to github.com over HTTPS).
    const cloneUrl =
      platform.repoToken && bundle.repo.cloneUrl.startsWith("https://github.com/")
        ? bundle.repo.cloneUrl.replace(
            "https://github.com/",
            `https://x-access-token:${platform.repoToken}@github.com/`,
          )
        : bundle.repo.cloneUrl;
    await runCommand(
      "git",
      ["clone", "--branch", bundle.repo.branch ?? "main", cloneUrl, repoDirFor(root)],
      root,
    );
  } else {
    await mkdir(scratchDirFor(root), { recursive: true });
    await runCommand("git", ["init"], scratchDirFor(root)).catch(() => undefined);
  }
  // Deduplicate by target filename: bundle assembly already sends one active
  // version per skill, but a duplicate name would otherwise write the same file
  // twice (order-dependent last-write-wins). Keep the last occurrence, once.
  const skillsByFile = new Map(bundle.skills.map((skill) => [safeName(skill.name), skill]));
  for (const root of [join(cwd, ".claude", "skills"), join(cwd, ".agents", "skills")]) {
    await mkdir(root, { recursive: true });
    for (const [fileBase, skill] of skillsByFile) {
      await writeFile(join(root, `${fileBase}.md`), skill.content);
    }
  }
  if (bundle.harness?.files) {
    for (const [relativePath, content] of Object.entries(bundle.harness.files)) {
      const path = join(cwd, relativePath);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content);
    }
  }
  process.env.ANTHROPIC_BASE_URL = bundle.gatewayUrls.anthropic;
  process.env.OPENAI_BASE_URL = bundle.gatewayUrls.openai;
  process.env.ANTHROPIC_API_KEY = virtualKey;
  process.env.OPENAI_API_KEY = virtualKey;
  // Platform key for KB/task writes (Project Owner / learning agents).
  process.env.FACILITY_PROJECT_ID = platform.projectId;
  if (platform.platformKey) process.env.FACILITY_PLATFORM_KEY = platform.platformKey;
  // Register every injected secret for redaction from captured check output.
  for (const secret of [virtualKey, platform.platformKey, platform.repoToken]) {
    if (secret) secretsToRedact.add(secret);
  }
}

async function runEngine(bundle: RunBundle, startedAt: number) {
  const timeoutMin = bundle.timeoutMin;
  if (bundle.engine === "claude_code") {
    const args = [
      "-p",
      composedPrompt(bundle),
      "--output-format",
      "stream-json",
      "--verbose",
      "--permission-mode",
      "bypassPermissions",
      "--max-turns",
      "500",
    ];
    addModelFlags(args, bundle.engineConfig);
    return runJsonProcess(
      "claude",
      args,
      cwdFor(bundle),
      parseClaudeStreamJsonLine,
      timeoutMin,
      startedAt,
    );
  }
  if (bundle.engine === "codex") {
    return runJsonProcess(
      "codex",
      ["exec", "--json", "-s", "danger-full-access", composedPrompt(bundle)],
      cwdFor(bundle),
      parseCodexJsonlLine,
      timeoutMin,
      startedAt,
    );
  }
  const cmd = typeof bundle.engineConfig.cmd === "string" ? bundle.engineConfig.cmd : "printf ''";
  return runShell(cmd, cwdFor(bundle), "assistant", timeoutMin);
}

function startSteeringPoll() {
  let stopped = false;
  void (async () => {
    let afterId: string | undefined;
    while (!stopped) {
      const query = afterId ? `?afterId=${encodeURIComponent(afterId)}` : "";
      const messages = await api<Array<{ id: string; body: string }>>(
        `/internal/runs/${currentRunId()}/steer${query}`,
      );
      for (const message of messages) {
        afterId = message.id;
        await appendFile(steerFile, `\n\n## ${new Date().toISOString()}\n${message.body}\n`);
        await emit([{ type: "steer", data: { id: message.id, applied: true } }]);
      }
    }
  })().catch(() => undefined);
  return () => {
    stopped = true;
  };
}

async function runJsonProcess(
  command: string,
  args: string[],
  cwd: string,
  parse: (line: string) => RunEvent | null,
  timeoutMin: number,
  startedAt: number,
) {
  const child = spawn(command, args, { cwd, env: engineEnv(), stdio: ["ignore", "pipe", "pipe"] });
  const stderr = createWriteStream(join(workRoot, "engine.stderr.log"), { flags: "a" });
  child.stderr.pipe(stderr);
  const clearTimers = armEngineTimeout(child, timeoutMin);
  const rl = createInterface({ input: child.stdout });
  for await (const line of rl) {
    const event = parse(line);
    if (event) await emit([event]);
  }
  const code = await exitCode(child);
  clearTimers();
  if (Date.now() - startedAt >= Math.max(1, timeoutMin - 2) * 60_000) {
    return 124;
  }
  return code;
}

async function runShell(command: string, cwd: string, eventType: string, timeoutMin: number) {
  const child = spawn("sh", ["-c", command], {
    cwd,
    env: engineEnv(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  const clearTimers = armEngineTimeout(child, timeoutMin);
  const drains = [child.stdout, child.stderr].map((stream) => {
    const rl = createInterface({ input: stream });
    return (async () => {
      for await (const line of rl)
        await emit([{ type: eventType, data: { text: redactSecrets(line) } }]);
    })();
  });
  const code = await exitCode(child);
  // Wait for both stream readers to finish draining before returning, so no
  // output line is emitted AFTER the caller records the run's result (a late
  // event would be dropped as post-terminal). Previously these loops were
  // fire-and-forget and could lose or reorder trailing output.
  await Promise.all(drains);
  clearTimers();
  return code;
}

async function emitChecks(cwd: string) {
  const path = join(cwd, ".agent-sdlc", "checks.jsonl");
  let body = "";
  try {
    body = await readFile(path, "utf8");
  } catch {
    return;
  }
  await emit(parseSelfReportedChecks(body));
}

// Parse the agent's self-reported checks.jsonl into `check` events. self_reported
// is forced true LAST so an agent-authored line can't spoof platform provenance by
// setting self_reported:false, and each line is isolated in its own try/catch so
// one malformed line can't throw out the whole batch (or abort before the
// platform-owned checks run).
export function parseSelfReportedChecks(body: string) {
  return body
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [{ type: "check", data: { ...JSON.parse(line), self_reported: true } }];
      } catch {
        return [];
      }
    });
}

// Run the platform-owned acceptance gates (bundle.checkCmds) after the engine.
// Each command's pass/fail is emitted as a `check` event (self_reported: false,
// distinct from the agent's own checks.jsonl) and the run fails if any command
// exits non-zero. Vacuously true when no checks are configured — runs without
// gates are unaffected.
async function runChecks(bundle: RunBundle, cwd: string) {
  let allPassed = true;
  for (const command of bundle.checkCmds) {
    const { code, tail } = await runCheckCommand(command, cwd, bundle.timeoutMin);
    if (code !== 0) allPassed = false;
    // Scrub injected secrets from the captured output before it is persisted to
    // run_events (readable by any runs:read principal).
    await emit([{ type: "check", data: checkEvent(command, code, redactSecrets(tail)) }]);
  }
  return allPassed;
}

// Shape of a platform-check event. `status` uses the passed/failed vocabulary the
// web cockpit tones on; output is carried only for failures (capped) so a red
// gate is debuggable without bloating the event log with green checks' logs.
export function checkEvent(command: string, code: number, tail: string) {
  return {
    self_reported: false,
    command,
    status: code === 0 ? "passed" : "failed",
    exit_code: code,
    ...(code === 0 || !tail ? {} : { output: tail.slice(-2000) }),
  };
}

// Run one check command, capturing a bounded tail of combined stdout+stderr for
// failure diagnostics. The command runs in its own process group (detached) so a
// hung check's ENTIRE tree — `pnpm test` spawning node workers, etc. — is
// signalled at the timeout, not just the top `sh` (whose death would orphan the
// workers until the sandbox is reaped).
export async function runCheckCommand(command: string, cwd: string, timeoutMin: number) {
  const child = spawn("sh", ["-c", command], {
    cwd,
    env: engineEnv(),
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  const clearTimers = armProcessGroupTimeout(child, timeoutMin);
  let tail = "";
  const capture = (stream: NodeJS.ReadableStream | null) =>
    new Promise<void>((resolve) => {
      if (!stream) return resolve();
      stream.on("data", (chunk) => {
        tail = (tail + chunk.toString()).slice(-4000);
      });
      stream.on("end", resolve);
      stream.on("error", () => resolve());
    });
  const drains = [capture(child.stdout), capture(child.stderr)];
  const code = await exitCode(child);
  await Promise.all(drains);
  clearTimers();
  return { code, tail: tail.trim() };
}

async function postResult(
  status: "succeeded" | "failed",
  startedAt: number,
  error?: Record<string, unknown>,
) {
  const stderrTail = await readFile(join(workRoot, "engine.stderr.log"), "utf8").catch(() => "");
  await api(`/internal/runs/${currentRunId()}/result`, {
    method: "POST",
    body: JSON.stringify({
      status,
      receipt: {
        provider: "byo",
        result: status,
        activity: {
          turns: 0,
          shell_commands: 0,
          file_changes: 0,
          mcp_tool_calls: 0,
          web_searches: 0,
          tool_calls: 0,
          errors: status === "failed" ? 1 : 0,
        },
        timing: {
          started_at: new Date(startedAt).toISOString(),
          ended_at: new Date().toISOString(),
          duration_ms: Date.now() - startedAt,
        },
      },
      error: error
        ? redactSecrets(`${JSON.stringify(error)} ${stderrTail.slice(-2000)}`)
        : undefined,
    }),
  });
}

async function emit(events: RunEvent[]) {
  if (events.length === 0) return;
  await api(`/internal/runs/${currentRunId()}/events`, {
    method: "POST",
    body: JSON.stringify(events),
  });
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { authorization: `Bearer ${runnerToken()}` };
  if (init.body) headers["content-type"] = "application/json";
  return fetchJson(`${apiUrl()}${path}`, {
    ...init,
    headers: {
      ...headers,
      ...(init.headers ?? {}),
    },
  }) as Promise<T>;
}

async function fetchJson(url: string, init: RequestInit = {}) {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`${url} failed ${response.status}: ${await response.text()}`);
  return response.json();
}

export function engineEnv() {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: "/work" };
  delete env.ANTHROPIC_AUTH_TOKEN;
  // Never expose the runner's internal-lifecycle credential to the (untrusted)
  // engine or check commands. With RUNNER_TOKEN a compromised agent could call
  // /internal/runs/:id/{events,result} for its own run to forge platform-provenance
  // check events or post a fake `succeeded` result — bypassing the very acceptance
  // gates the runner enforces. The runner keeps its own RUNNER_TOKEN in its process
  // env for its api() calls; the child simply never inherits it. (The agent still
  // reaches the platform's v1 API via FACILITY_API_URL + FACILITY_PLATFORM_KEY,
  // which are separately authorized and cannot touch run lifecycle.)
  delete env.RUNNER_TOKEN;
  return env;
}

function cwdFor(bundle: RunBundle, root = workRoot) {
  return bundle.repo.cloneUrl ? repoDirFor(root) : scratchDirFor(root);
}

function repoDirFor(root: string) {
  return join(root, "repo");
}

function scratchDirFor(root: string) {
  return join(root, "scratch");
}

async function runCommand(command: string, args: string[], cwd: string) {
  const child = spawn(command, args, { cwd, stdio: "inherit" });
  const code = await exitCode(child);
  if (code !== 0) throw new Error(`${command} exited ${code}`);
}

function exitCode(child: ReturnType<typeof spawn>) {
  return new Promise<number>((resolve) => child.on("close", (code) => resolve(code ?? 1)));
}

// Arm the engine timeout: SIGTERM at (timeout - 2min), then escalate to SIGKILL
// if the engine ignores it, so a process that traps/ignores SIGTERM cannot run
// (and bill) unbounded. Returns a disposer that cancels both timers on clean exit.
function armEngineTimeout(child: ReturnType<typeof spawn>, timeoutMin: number) {
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  const termTimer = setTimeout(
    () => {
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), 15_000);
    },
    Math.max(1, timeoutMin - 2) * 60_000,
  );
  return () => {
    clearTimeout(termTimer);
    if (killTimer) clearTimeout(killTimer);
  };
}

// Like armEngineTimeout, but signals the child's whole PROCESS GROUP (negative
// pid) — the child must have been spawned `detached: true`. Used for checks so a
// hung command's descendants die with it instead of being orphaned. Falls back to
// signalling just the child if the group is already gone.
function armProcessGroupTimeout(child: ReturnType<typeof spawn>, timeoutMin: number) {
  const signalGroup = (signal: NodeJS.Signals) => {
    try {
      if (child.pid) process.kill(-child.pid, signal);
      else child.kill(signal);
    } catch {
      child.kill(signal);
    }
  };
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  const termTimer = setTimeout(
    () => {
      signalGroup("SIGTERM");
      killTimer = setTimeout(() => signalGroup("SIGKILL"), 15_000);
    },
    Math.max(1, timeoutMin - 2) * 60_000,
  );
  return () => {
    clearTimeout(termTimer);
    if (killTimer) clearTimeout(killTimer);
  };
}

export function composedPrompt(bundle: RunBundle) {
  const harnessNote = bundle.harness?.files
    ? "\n\nProject harness/KB context is in ./harness/SESSION.md - read it first."
    : "";
  return `${bundle.contract}\n\nScope:\n${JSON.stringify(bundle.scope, null, 2)}${harnessNote}`;
}

function addModelFlags(args: string[], config: Record<string, unknown>) {
  if (typeof config.model === "string") args.push("--model", config.model);
}

function safeName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function requiredEnv(key: string) {
  const value = process.env[key];
  if (!value) throw new Error(`${key} is required`);
  return value;
}

function apiUrl() {
  return requiredEnv("FACILITY_API_URL").replace(/\/$/, "");
}

function currentRunId() {
  return requiredEnv("RUN_ID");
}

function runnerToken() {
  return requiredEnv("RUNNER_TOKEN");
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
