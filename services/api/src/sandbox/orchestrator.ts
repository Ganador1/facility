import { generateApiKey, hashKey, newId, seal } from "@facility/core";
import {
  agentDefs,
  createDb,
  insertAuditEvent,
  llmRequests,
  platformIssues,
  registryItems,
  registryVersions,
  repos,
  runs,
  sandboxProfiles,
  virtualKeys,
} from "@facility/db";
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { AppConfig } from "../types.js";
import { DockerSandboxDriver } from "./docker.js";
import type { LaunchSpec, SandboxDriverName } from "./driver.js";
import { sandboxDriver } from "./driver.js";
import {
  appendRunEvents,
  type RunBundle,
  type RunnerEngine,
  readSandbox,
  terminalStatus,
} from "./state.js";

type DispatchJob = { runId?: string; orgId?: string };
type RunRow = typeof runs.$inferSelect;

export async function dispatchRun(config: AppConfig, job: DispatchJob) {
  if (!job.runId || !job.orgId) throw new Error("runs.dispatch requires runId and orgId");
  const { db, client } = createDb(config.databaseUrl);
  try {
    const run = await loadRun(db, job.orgId, job.runId);
    if (run?.status !== "queued") return;
    await db
      .update(runs)
      .set({ status: "provisioning", updatedAt: new Date() })
      .where(eq(runs.id, run.id));
    await appendRunEvents(db, run.orgId, run.id, [{ type: "provisioning", data: {} }]);

    const { bundle, profile } = await buildRunBundle(db, run, config);
    const virtualKey = await generateApiKey("fvk");
    await db.insert(virtualKeys).values({
      id: virtualKey.id,
      orgId: run.orgId,
      projectId: run.projectId,
      runId: run.id,
      name: `Run ${run.id}`,
      prefix: virtualKey.lookup,
      last4: virtualKey.last4,
      hash: virtualKey.hash,
      allowedModels: modelNames(bundle.engineConfig),
      expiresAt: new Date(Date.now() + bundle.timeoutMin * 60_000),
    });

    const runnerToken = `frt_${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
    const driverName = normalizeDriver(profile.driver);
    const driver = await sandboxDriver(driverName);
    const launchSpec: LaunchSpec = {
      runId: run.id,
      image: profile.image,
      env: {
        FACILITY_API_URL: config.publicUrl,
        RUN_ID: run.id,
        RUNNER_TOKEN: runnerToken,
      },
      cpu: resourceNumber(profile.resources, "cpu", 2),
      memoryMb: resourceNumber(profile.resources, "memory_mb", 4096),
      timeoutMin: bundle.timeoutMin,
      cmd: command(profile.setup),
    };
    const launched = await driver.launch(launchSpec);
    await db
      .update(runs)
      .set({
        sandbox: {
          driver: driver.name,
          ref: launched.ref,
          image: profile.image,
          runnerTokenHash: await hashKey(runnerToken),
          virtualKeyId: virtualKey.id,
          sealedVirtualKey: await seal(virtualKey.secret, config.secretMasterKey),
          bundle,
          launchedAt: new Date().toISOString(),
        },
        updatedAt: new Date(),
      })
      .where(eq(runs.id, run.id));
    await appendRunEvents(db, run.orgId, run.id, [
      { type: "sandbox", data: { driver: driver.name, ref: launched.ref } },
    ]);
  } catch (error) {
    await failRun(db, job.orgId, job.runId, errorMessage(error), "provision_failed").catch(
      () => undefined,
    );
    throw error;
  } finally {
    await client.end();
  }
}

export async function finishRun(
  db: ReturnType<typeof createDb>["db"],
  run: RunRow,
  input: {
    status: "succeeded" | "failed";
    receipt?: Record<string, unknown>;
    error?: string;
  },
) {
  if (terminalStatus(run.status)) return run;
  const sandbox = readSandbox(run.sandbox);
  const aggregate = await gatewayAggregate(db, run.id);
  const receipt = {
    ...(input.receipt ?? {}),
    usage: {
      ...(typeof input.receipt?.usage === "object" && input.receipt.usage !== null
        ? input.receipt.usage
        : {}),
      input_tokens: aggregate.inputTokens,
      output_tokens: aggregate.outputTokens,
      cache_read: aggregate.cacheRead,
      cache_write: aggregate.cacheWrite,
      cost_cents: aggregate.costCents,
      cost_source: "gateway",
    },
    events: { count: aggregate.eventCount, checks: aggregate.checkCount },
  };
  const row = (
    await db
      .update(runs)
      .set({
        status: input.status,
        receipt,
        error: input.error,
        endedAt: new Date(),
        sandbox: { ...sandbox, finishedAt: new Date().toISOString() },
        updatedAt: new Date(),
      })
      .where(eq(runs.id, run.id))
      .returning()
  )[0];
  if (sandbox.driver && sandbox.ref) {
    const driver = await sandboxDriver(sandbox.driver);
    await driver.destroy(sandbox.ref).catch(() => undefined);
  }
  if (sandbox.virtualKeyId) {
    await db
      .update(virtualKeys)
      .set({ revokedAt: new Date() })
      .where(eq(virtualKeys.id, sandbox.virtualKeyId));
  }
  await appendRunEvents(db, run.orgId, run.id, [
    { type: "result", data: { status: input.status } },
  ]);
  await insertAuditEvent(db, {
    orgId: run.orgId,
    actor: { type: "agent", id: run.id },
    action: "run.finished",
    target: { type: "run", id: run.id },
    payload: { status: input.status },
  });
  return row ?? run;
}

export async function cancelRun(config: AppConfig, run: RunRow) {
  const sandbox = readSandbox(run.sandbox);
  if (sandbox.driver && sandbox.ref) {
    const driver = await sandboxDriver(sandbox.driver);
    await driver.stop(sandbox.ref).catch(() => undefined);
    await driver.destroy(sandbox.ref).catch(() => undefined);
  }
  const { db, client } = createDb(config.databaseUrl);
  try {
    if (sandbox.virtualKeyId) {
      await db
        .update(virtualKeys)
        .set({ revokedAt: new Date() })
        .where(eq(virtualKeys.id, sandbox.virtualKeyId));
    }
  } finally {
    await client.end();
  }
}

export async function reconcileSandboxes(config: AppConfig) {
  const { db, client } = createDb(config.databaseUrl);
  const docker = new DockerSandboxDriver();
  try {
    for (const container of await docker.listFacilityContainers()) {
      const run = (await db.select().from(runs).where(eq(runs.id, container.runId)).limit(1))[0];
      const sandbox = readSandbox(run?.sandbox);
      if (!run || terminalStatus(run.status) || sandbox.ref !== container.ref) {
        await docker.destroy(container.ref);
      }
    }

    const liveRuns = await db
      .select()
      .from(runs)
      .where(inArray(runs.status, ["provisioning", "running"]));
    for (const run of liveRuns) {
      const sandbox = readSandbox(run.sandbox);
      if (!sandbox.driver || !sandbox.ref) continue;
      const status = await (await sandboxDriver(sandbox.driver)).status(sandbox.ref);
      if (status === "exited" || status === "lost") {
        await failRun(db, run.orgId, run.id, "sandbox_lost", "sandbox_lost");
      }
    }
  } finally {
    await client.end();
  }
}

async function buildRunBundle(
  db: ReturnType<typeof createDb>["db"],
  run: RunRow,
  config: AppConfig,
) {
  const agent = run.agentDefId
    ? (await db.select().from(agentDefs).where(eq(agentDefs.id, run.agentDefId)).limit(1))[0]
    : undefined;
  if (!agent) throw new Error("run_missing_agent_def");
  const profile = (
    await db
      .select()
      .from(sandboxProfiles)
      .where(
        and(
          eq(sandboxProfiles.orgId, run.orgId),
          agent.sandboxProfileId
            ? eq(sandboxProfiles.id, agent.sandboxProfileId)
            : or(eq(sandboxProfiles.id, "sbx_dev_default"), isNull(sandboxProfiles.projectId)),
        ),
      )
      .limit(1)
  )[0];
  if (!profile) throw new Error("run_missing_sandbox_profile");
  const repo = (
    await db
      .select()
      .from(repos)
      .where(and(eq(repos.orgId, run.orgId), eq(repos.projectId, run.projectId)))
      .limit(1)
  )[0];
  const contract = await activeRegistryContent(db, run.orgId, agent.contractItemId);
  const skills = await activeSkills(db, run.orgId);
  const timeoutMin = resourceNumber(profile.resources, "timeout_min", 60);
  const gatewayBase = config.publicUrl.replace(/\/$/, "");
  const bundle: RunBundle = {
    runId: run.id,
    mode: run.mode,
    engine: normalizeEngine(agent.engine || run.engine),
    contract,
    skills,
    engineConfig: objectOrEmpty(agent.model),
    repo: repo
      ? {
          cloneUrl: `https://github.com/${repo.owner}/${repo.name}.git`,
          branch: repo.defaultBranch,
          installationTokenRef: repo.installationId,
        }
      : { cloneUrl: null, branch: null, installationTokenRef: null },
    provisionCmd:
      stringField(profile.setup, "provision_cmd") ?? stringField(profile.setup, "provisionCmd"),
    checkCmds: arrayField(profile.setup, "check_cmds"),
    gatewayUrls: {
      anthropic: `${gatewayBase}/gateway/anthropic`,
      openai: `${gatewayBase}/gateway/openai`,
    },
    scope: objectOrEmpty(run.trigger),
    timeoutMin,
  };
  return { bundle, profile };
}

async function activeRegistryContent(
  db: ReturnType<typeof createDb>["db"],
  orgId: string,
  itemId: string,
) {
  const row = (
    await db
      .select({ version: registryVersions })
      .from(registryVersions)
      .innerJoin(registryItems, eq(registryVersions.itemId, registryItems.id))
      .where(
        and(
          eq(registryItems.orgId, orgId),
          eq(registryItems.id, itemId),
          eq(registryVersions.status, "active"),
        ),
      )
      .orderBy(desc(registryVersions.version))
      .limit(1)
  )[0];
  if (!row) throw new Error("registry_contract_missing");
  return row.version.content;
}

async function activeSkills(db: ReturnType<typeof createDb>["db"], orgId: string) {
  return (
    await db
      .select({ name: registryItems.name, content: registryVersions.content })
      .from(registryVersions)
      .innerJoin(registryItems, eq(registryVersions.itemId, registryItems.id))
      .where(
        and(
          eq(registryItems.orgId, orgId),
          eq(registryItems.kind, "skill"),
          eq(registryVersions.status, "active"),
        ),
      )
      .orderBy(registryItems.name)
  ).map((row) => ({ name: row.name, content: row.content }));
}

async function failRun(
  db: ReturnType<typeof createDb>["db"],
  orgId: string,
  runId: string,
  message: string,
  kind: string,
) {
  await db
    .update(runs)
    .set({ status: "failed", error: message, endedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(runs.orgId, orgId), eq(runs.id, runId)));
  await db.insert(platformIssues).values({
    id: newId("iss"),
    orgId,
    fingerprint: `run_failure:${runId}:${kind}`,
    kind: "run_failure",
    severity: "high",
    title: kind,
    bodyMd: message,
    state: "open",
  });
  await appendRunEvents(db, orgId, runId, [
    { type: "result", data: { status: "failed", kind, error: message } },
  ]);
}

async function loadRun(db: ReturnType<typeof createDb>["db"], orgId: string, runId: string) {
  return (
    await db
      .select()
      .from(runs)
      .where(and(eq(runs.orgId, orgId), eq(runs.id, runId)))
      .limit(1)
  )[0];
}

async function gatewayAggregate(db: ReturnType<typeof createDb>["db"], runId: string) {
  const usage = (
    await db
      .select({
        inputTokens: sql<number>`coalesce(sum(${llmRequests.inputTokens}), 0)`,
        outputTokens: sql<number>`coalesce(sum(${llmRequests.outputTokens}), 0)`,
        cacheRead: sql<number>`coalesce(sum(${llmRequests.cacheRead}), 0)`,
        cacheWrite: sql<number>`coalesce(sum(${llmRequests.cacheWrite}), 0)`,
        costCents: sql<number>`coalesce(sum(${llmRequests.costCents}), 0)`,
      })
      .from(llmRequests)
      .where(eq(llmRequests.runId, runId))
  )[0];
  const events = await db.execute(sql`
    select
      count(*)::int as event_count,
      count(*) filter (where type = 'check')::int as check_count
    from run_events
    where run_id = ${runId}
  `);
  const eventRow = (events as unknown as Array<{ event_count: number; check_count: number }>)[0];
  return {
    inputTokens: Number(usage?.inputTokens ?? 0),
    outputTokens: Number(usage?.outputTokens ?? 0),
    cacheRead: Number(usage?.cacheRead ?? 0),
    cacheWrite: Number(usage?.cacheWrite ?? 0),
    costCents: Number(usage?.costCents ?? 0),
    eventCount: Number(eventRow?.event_count ?? 0),
    checkCount: Number(eventRow?.check_count ?? 0),
  };
}

function normalizeDriver(value: string): SandboxDriverName {
  if (value === "aws") return "aws";
  return "docker";
}

function normalizeEngine(value: string): RunnerEngine {
  if (value === "claude_code" || value === "claude") return "claude_code";
  if (value === "byo") return "byo";
  return "codex";
}

function resourceNumber(value: unknown, key: string, fallback: number) {
  const candidate = objectOrEmpty(value)[key];
  return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : fallback;
}

function stringField(value: unknown, key: string) {
  const candidate = objectOrEmpty(value)[key];
  return typeof candidate === "string" && candidate.trim() ? candidate : null;
}

function arrayField(value: unknown, key: string) {
  const candidate = objectOrEmpty(value)[key];
  return Array.isArray(candidate)
    ? candidate.filter((item): item is string => typeof item === "string")
    : [];
}

function command(value: unknown) {
  const candidate = objectOrEmpty(value).cmd;
  return Array.isArray(candidate)
    ? candidate.filter((item): item is string => typeof item === "string")
    : undefined;
}

function modelNames(value: Record<string, unknown>) {
  const model = value.model;
  return typeof model === "string" ? [model] : undefined;
}

function objectOrEmpty(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
