import { createInterface } from "node:readline/promises";
import { stdin as processStdin, stdout as processStdout } from "node:process";
import { loadConfig, saveConfig, getProfile } from "./platform-config.mjs";
import { accent, bold, dim } from "./ui.mjs";

class CliError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.exitCode = exitCode;
  }
}

export async function runPlatformCommand(command, args, options = {}) {
  const stdout = options.stdout || process.stdout;
  try {
    const { flags, positional } = parseArgs(args);
    const config = options.config || loadConfig(options.configPath);
    const ctx = {
      fetch: options.fetch || fetch,
      stdout,
      stderr: options.stderr || process.stderr,
      stdin: options.stdin || process.stdin,
      config,
      configPath: options.configPath,
      json: Boolean(flags.json),
      profileName: flags.profile,
    };

    if (command === "login") return await login(flags, ctx);
    const [group, ...rest] = [command, ...positional];
    const authed = clientContext(ctx);

    switch (group) {
      case "status":
        return await status(authed, flags);
      case "projects":
        return await projects(rest, authed, flags);
      case "runs":
        return await runs(rest, authed, flags);
      case "inbox":
        return await inbox(rest, authed, flags);
      case "kickstart":
        return await kickstart(rest, authed, flags, ctx);
      case "upgrade":
        return await upgrade(rest, authed, flags);
      case "keys":
        return await keys(rest, authed, flags);
      default:
        throw new CliError(`Unknown platform command: ${group}`, 1);
    }
  } catch (error) {
    const exitCode = error.exitCode || (error.status === 401 ? 2 : 1);
    stdout.write(`${error.message || "Facility command failed"}\n`);
    return exitCode;
  }
}

function parseArgs(args) {
  const flags = {};
  const positional = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") flags.json = true;
    else if (arg === "--yes" || arg === "-y") flags.yes = true;
    else if (arg.startsWith("--") && arg.includes("=")) {
      const [key, ...rest] = arg.slice(2).split("=");
      flags[key] = rest.join("=");
    } else if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[index + 1];
      if (next && !next.startsWith("-")) {
        flags[key] = next;
        index += 1;
      } else flags[key] = true;
    } else positional.push(arg);
  }
  return { flags, positional };
}

async function login(flags, ctx) {
  const url = flags.url || (await prompt("API URL", ctx));
  const key = flags.key || (await prompt("API key", ctx));
  const profile = flags.profile || "default";
  const me = await request({ url, key, fetch: ctx.fetch }, "GET", "/v1/me");
  const next = {
    ...ctx.config,
    currentProfile: profile,
    profiles: {
      ...(ctx.config.profiles || {}),
      [profile]: { url: stripSlash(url), key },
    },
  };
  saveConfig(next, ctx.configPath || ctx.config.path);
  if (ctx.json) writeJson(ctx, { profile, org: me.org, principal: me.principal });
  else ctx.stdout.write(`  ${bold("login")} ${dim(profile)} verified for ${me.org?.slug || me.org?.name || "Facility"}\n`);
  return 0;
}

async function status(ctx) {
  const projects = await api(ctx, "GET", "/v1/projects");
  const inbox = await api(ctx, "GET", "/v1/inbox", { query: { state: "open" } });
  const issues = await api(ctx, "GET", "/v1/issues", { query: { state: "open" } });
  const spend = await api(ctx, "GET", "/v1/spend", { query: { from: monthStart(), groupBy: "day" } });
  const runs = (
    await Promise.all(
      asArray(projects).map((project) =>
        api(ctx, "GET", `/v1/projects/${project.id}/runs`, { query: { status: "running" } }).catch(() => [])
      )
    )
  ).flat();
  const payload = { projects, liveRuns: runs, inbox, issues, spend };
  if (ctx.json) writeJson(ctx, payload);
  else {
    ctx.stdout.write(`\n${bold("Facility status")}\n`);
    ctx.stdout.write(row("projects", asArray(projects).length));
    ctx.stdout.write(row("live runs", asArray(runs).length, true));
    ctx.stdout.write(row("open inbox", asArray(inbox).length));
    ctx.stdout.write(row("open issues", asArray(issues).length));
    ctx.stdout.write(row("spend MTD", cents(sum(asArray(spend), "cost_cents"))));
  }
  return 0;
}

async function projects(args, ctx) {
  const sub = args[0];
  if (sub === "list") {
    const projects = await api(ctx, "GET", "/v1/projects");
    if (ctx.json) writeJson(ctx, projects);
    else table(ctx, ["slug", "name", "status"], asArray(projects).map((p) => [p.slug, p.name, p.status]));
    return 0;
  }
  if (sub === "get") {
    const project = await resolveProject(ctx, args[1]);
    if (ctx.json) writeJson(ctx, project);
    else table(ctx, ["field", "value"], Object.entries(project).slice(0, 12));
    return 0;
  }
  throw new CliError("Usage: facility projects list|get <slug>");
}

async function runs(args, ctx, flags) {
  const sub = args[0];
  if (sub === "list") {
    const runs = flags.project
      ? await api(ctx, "GET", `/v1/projects/${(await resolveProject(ctx, flags.project)).id}/runs`, {
          query: { status: flags.status },
        })
      : await runsForAllProjects(ctx, flags.status);
    if (ctx.json) writeJson(ctx, runs);
    else table(ctx, ["id", "project", "status", "mode"], asArray(runs).map((r) => [r.id, r.projectId, r.status, r.mode]), { live: true });
    return 0;
  }
  if (sub === "trigger") {
    const project = await resolveProject(ctx, args[1]);
    const agent = args[2];
    if (!agent) throw new CliError("Usage: facility runs trigger <project> <agent> [--input]");
    const input = parseInput(flags.input);
    const result = await api(ctx, "POST", `/v1/projects/${project.id}/runs`, {
      body: { mode: "manual", engine: "codex", trigger: { source: "cli", agentName: agent, input } },
    });
    output(ctx, result, () => `  ${accent("run")} ${result.id || "(queued)"} triggered\n`);
    return 0;
  }
  if (sub === "steer") {
    const runId = args[1];
    const message = args.slice(2).join(" ");
    if (!runId || !message) throw new CliError("Usage: facility runs steer <id> <message>");
    const result = await api(ctx, "POST", `/v1/runs/${runId}/steer`, { body: { body: message } });
    output(ctx, result, () => `  ${accent("steer")} ${runId}\n`);
    return 0;
  }
  if (sub === "watch") return watchRun(ctx, args[1]);
  throw new CliError("Usage: facility runs list|watch|trigger|steer");
}

async function inbox(args, ctx, flags) {
  if (!args.length) {
    const items = await api(ctx, "GET", "/v1/inbox", { query: { state: flags.state || "open" } });
    if (ctx.json) writeJson(ctx, items);
    else table(ctx, ["id", "state", "action", "project"], asArray(items).map((item) => [item.id, item.state, item.actionTypeId, item.projectId]));
    return 0;
  }
  if (args[0] === "decide") {
    const [id, decision] = [args[1], args[2]];
    if (!id || !["approve", "reject"].includes(decision)) throw new CliError("Usage: facility inbox decide <id> approve|reject [--note]");
    const result = await api(ctx, "POST", `/v1/proposals/${id}/decide`, { body: { decision, note: flags.note } });
    output(ctx, result, () => `  ${bold(decision)} ${id}\n`);
    return 0;
  }
  throw new CliError("Usage: facility inbox [decide <id> approve|reject]");
}

async function kickstart(args, ctx, flags, rawCtx) {
  const project = await resolveProject(ctx, args[0]);
  if (!flags.repo) throw new CliError("Usage: facility kickstart <project> --repo owner/name [--yes]");
  const preview = await api(ctx, "GET", `/v1/projects/${project.id}/kickstart/preview`, { query: { repo: flags.repo } });
  if (!flags.yes && !ctx.json) {
    table(ctx, ["path", "size", "sha256"], asArray(preview.files || preview).map((file) => [file.path, file.size, file.sha256]));
    const answer = await prompt("Open kickstart PR? [y/N]", rawCtx);
    if (!/^y(es)?$/i.test(answer.trim())) throw new CliError("Cancelled", 1);
  }
  const result = await api(ctx, "POST", `/v1/projects/${project.id}/kickstart`, { body: { repo: flags.repo, answers: flags } });
  output(ctx, result, () => `  ${bold("kickstart")} PR requested for ${flags.repo}\n`);
  return 0;
}

async function upgrade(args, ctx, flags) {
  const project = await resolveProject(ctx, args[0]);
  const result = await api(ctx, "POST", `/v1/projects/${project.id}/upgrade`, { body: { toVersion: flags.to } });
  output(ctx, result, () => `  ${bold("upgrade")} requested for ${project.slug || project.id}\n`);
  return 0;
}

async function keys(args, ctx, flags) {
  const sub = args[0];
  if (sub === "list") {
    const result = await api(ctx, "GET", "/v1/keys");
    if (ctx.json) writeJson(ctx, result);
    else table(ctx, ["id", "name", "last4", "revoked"], asArray(result).map((key) => [key.id, key.name, key.last4, key.revokedAt ? "yes" : "no"]));
    return 0;
  }
  if (sub === "revoke") {
    const id = args[1];
    if (!id) throw new CliError("Usage: facility keys revoke <id>");
    const result = await api(ctx, "DELETE", `/v1/keys/${id}`);
    output(ctx, result, () => `  ${bold("revoked")} ${id}\n`);
    return 0;
  }
  if (sub === "issue") {
    const name = flags.name || args[1] || "facility-cli";
    const roleId = flags.role || flags.roleId;
    if (!roleId) throw new CliError("facility keys issue requires --role <roleId>");
    const result = await api(ctx, "POST", "/v1/keys", { body: { name, roleId, projectId: flags.project } });
    output(ctx, result, () => `  ${bold("issued")} ${result.id} ${dim(`last4 ${result.last4}`)}\n`);
    return 0;
  }
  throw new CliError("Usage: facility keys issue|revoke|list");
}

function clientContext(ctx) {
  const { name, value } = getProfile(ctx.config, ctx.profileName);
  if (!value?.url || !value?.key) throw new CliError(`Not logged in for profile "${name}". Run facility login.`, 2);
  return { ...ctx, profileName: name, url: value.url, key: value.key };
}

async function api(ctx, method, path, options = {}) {
  return request(ctx, method, path, options);
}

async function request(ctx, method, path, options = {}) {
  const url = new URL(`${stripSlash(ctx.url)}${path}`);
  for (const [key, value] of Object.entries(options.query || {})) if (value !== undefined) url.searchParams.set(key, String(value));
  const response = await ctx.fetch(url, {
    method,
    headers: {
      ...(options.body === undefined ? {} : { "content-type": "application/json" }),
      authorization: `Bearer ${ctx.key}`,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const payload = await response.json().catch(() => undefined);
  if (!response.ok) throw new CliError(payload?.error?.message || `Facility API returned ${response.status}`, response.status === 401 ? 2 : 1);
  return payload;
}

async function resolveProject(ctx, slugOrId) {
  if (!slugOrId) throw new CliError("Project is required.");
  if (slugOrId.startsWith("proj_")) return api(ctx, "GET", `/v1/projects/${slugOrId}`);
  const projects = await api(ctx, "GET", "/v1/projects");
  const found = asArray(projects).find((project) => project.slug === slugOrId || project.id === slugOrId);
  if (!found) throw new CliError(`Project not found: ${slugOrId}`);
  return found;
}

async function runsForAllProjects(ctx, status) {
  const projects = await api(ctx, "GET", "/v1/projects");
  return (
    await Promise.all(
      asArray(projects).map((project) =>
        api(ctx, "GET", `/v1/projects/${project.id}/runs`, { query: { status } }).catch(() => [])
      )
    )
  ).flat();
}

async function watchRun(ctx, runId) {
  if (!runId) throw new CliError("Usage: facility runs watch <id>");
  const response = await ctx.fetch(new URL(`${stripSlash(ctx.url)}/v1/runs/${runId}/stream`), {
    headers: { authorization: `Bearer ${ctx.key}` },
  });
  if (!response.ok) throw new CliError(`Facility API returned ${response.status}`, response.status === 401 ? 2 : 1);
  if (!response.body) return 0;
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() || "";
    for (const chunk of chunks) {
      const data = chunk.match(/^data: (.+)$/m)?.[1];
      if (data) ctx.stdout.write(`  ${accent("agent-live")} ${data}\n`);
    }
  }
  return 0;
}

async function prompt(label, ctx) {
  const rl = createInterface({ input: ctx.stdin || processStdin, output: ctx.stdout === process.stdout ? processStdout : undefined });
  try {
    return await rl.question(`${label}: `);
  } finally {
    rl.close();
  }
}

function output(ctx, payload, human) {
  if (ctx.json) writeJson(ctx, payload);
  else ctx.stdout.write(human());
}

function writeJson(ctx, payload) {
  ctx.stdout.write(`${JSON.stringify(payload)}\n`);
}

function table(ctx, headers, rows, options = {}) {
  const all = [headers, ...rows.map((row) => row.map((value) => String(value ?? "")))];
  const widths = headers.map((_, index) => Math.max(...all.map((row) => String(row[index] ?? "").length)));
  ctx.stdout.write(`\n  ${headers.map((cell, index) => bold(cell.padEnd(widths[index]))).join("  ")}\n`);
  for (const rowValues of rows) {
    const line = rowValues.map((value, index) => String(value ?? "").padEnd(widths[index])).join("  ");
    ctx.stdout.write(`  ${options.live ? accent(line) : line}\n`);
  }
}

function row(label, value, live = false) {
  const line = `  ${String(label).padEnd(12)} ${value}\n`;
  return live ? accent(line) : line;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function sum(rows, key) {
  return rows.reduce((total, row) => total + Number(row?.[key] || 0), 0);
}

function cents(value) {
  return `$${(Number(value || 0) / 100).toFixed(2)}`;
}

function monthStart() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

function stripSlash(value) {
  return String(value).replace(/\/$/, "");
}

function parseInput(value) {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
