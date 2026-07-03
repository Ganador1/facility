#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { parseClaudeStreamJsonLine, parseCodexJsonlLine } from "./parsers.js";
import type { RunBundle, RunEvent } from "./types.js";

const apiUrl = requiredEnv("FACILITY_API_URL").replace(/\/$/, "");
const runId = requiredEnv("RUN_ID");
const runnerToken = requiredEnv("RUNNER_TOKEN");
const workRoot = "/work";
const repoDir = join(workRoot, "repo");
const scratchDir = join(workRoot, "scratch");
const steerFile = join(workRoot, "STEERING.md");

async function main() {
  const startedAt = Date.now();
  let bundle: RunBundle | null = null;
  let steerStop: (() => void) | undefined;
  try {
    const hello = await api<Record<string, unknown>>(`/internal/runs/${runId}/hello`, {
      method: "POST",
    });
    bundle = (await fetchJson(String(hello.bundleUrl))) as RunBundle;
    await prepareWorkspace(bundle, String(hello.virtualKey));
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
    const code = await runEngine(bundle, startedAt);
    await emitChecks(cwdFor(bundle));
    await postResult(
      code === 0 ? "succeeded" : "failed",
      startedAt,
      code === 0 ? undefined : { code },
    );
  } catch (error) {
    await postResult("failed", startedAt, { error: errorMessage(error) }).catch(() => undefined);
    process.exitCode = 1;
  } finally {
    steerStop?.();
  }
}

async function prepareWorkspace(bundle: RunBundle, virtualKey: string) {
  await mkdir(workRoot, { recursive: true });
  await writeFile(join(workRoot, "contract.md"), bundle.contract);
  const cwd = cwdFor(bundle);
  if (bundle.repo.cloneUrl) {
    await runCommand(
      "git",
      ["clone", "--branch", bundle.repo.branch ?? "main", bundle.repo.cloneUrl, repoDir],
      workRoot,
    );
  } else {
    await mkdir(scratchDir, { recursive: true });
    await runCommand("git", ["init"], scratchDir).catch(() => undefined);
  }
  for (const root of [join(cwd, ".claude", "skills"), join(cwd, ".agents", "skills")]) {
    await mkdir(root, { recursive: true });
    for (const skill of bundle.skills) {
      await writeFile(join(root, `${safeName(skill.name)}.md`), skill.content);
    }
  }
  await writeFile(
    join(cwd, ".facility-engine-env"),
    [
      `ANTHROPIC_BASE_URL=${bundle.gatewayUrls.anthropic}`,
      `OPENAI_BASE_URL=${bundle.gatewayUrls.openai}`,
      `ANTHROPIC_API_KEY=${virtualKey}`,
      `OPENAI_API_KEY=${virtualKey}`,
    ].join("\n"),
  );
  process.env.ANTHROPIC_BASE_URL = bundle.gatewayUrls.anthropic;
  process.env.OPENAI_BASE_URL = bundle.gatewayUrls.openai;
  process.env.ANTHROPIC_API_KEY = virtualKey;
  process.env.OPENAI_API_KEY = virtualKey;
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
        `/internal/runs/${runId}/steer${query}`,
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
  const timer = setTimeout(() => child.kill("SIGTERM"), Math.max(1, timeoutMin - 2) * 60_000);
  const rl = createInterface({ input: child.stdout });
  for await (const line of rl) {
    const event = parse(line);
    if (event) await emit([event]);
  }
  const code = await exitCode(child);
  clearTimeout(timer);
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
  const timer = setTimeout(() => child.kill("SIGTERM"), Math.max(1, timeoutMin - 2) * 60_000);
  for (const stream of [child.stdout, child.stderr]) {
    const rl = createInterface({ input: stream });
    void (async () => {
      for await (const line of rl) await emit([{ type: eventType, data: { text: line } }]);
    })();
  }
  const code = await exitCode(child);
  clearTimeout(timer);
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
  const events = body
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => ({ type: "check", data: { self_reported: true, ...JSON.parse(line) } }));
  await emit(events);
}

async function postResult(
  status: "succeeded" | "failed",
  startedAt: number,
  error?: Record<string, unknown>,
) {
  const stderrTail = await readFile(join(workRoot, "engine.stderr.log"), "utf8").catch(() => "");
  await api(`/internal/runs/${runId}/result`, {
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
      error: error ? `${JSON.stringify(error)} ${stderrTail.slice(-2000)}` : undefined,
    }),
  });
}

async function emit(events: RunEvent[]) {
  if (events.length === 0) return;
  await api(`/internal/runs/${runId}/events`, { method: "POST", body: JSON.stringify(events) });
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { authorization: `Bearer ${runnerToken}` };
  if (init.body) headers["content-type"] = "application/json";
  return fetchJson(`${apiUrl}${path}`, {
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

function engineEnv() {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: "/work" };
  delete env.ANTHROPIC_AUTH_TOKEN;
  return env;
}

function cwdFor(bundle: RunBundle) {
  return bundle.repo.cloneUrl ? repoDir : scratchDir;
}

async function runCommand(command: string, args: string[], cwd: string) {
  const child = spawn(command, args, { cwd, stdio: "inherit" });
  const code = await exitCode(child);
  if (code !== 0) throw new Error(`${command} exited ${code}`);
}

function exitCode(child: ReturnType<typeof spawn>) {
  return new Promise<number>((resolve) => child.on("close", (code) => resolve(code ?? 1)));
}

function composedPrompt(bundle: RunBundle) {
  return `${bundle.contract}\n\nScope:\n${JSON.stringify(bundle.scope, null, 2)}`;
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

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

main();
