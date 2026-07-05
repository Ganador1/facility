import { generateApiKey, newId, seal } from "@facility/core";
import {
  budgets,
  createDb,
  llmRequests,
  migrate,
  platformIssues,
  projects,
  providerCredentials,
  seed,
  spendCounters,
  virtualKeys,
} from "@facility/db";
import { and, eq, ne, sql } from "drizzle-orm";
import Fastify, { type FastifyInstance } from "fastify";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { clearAuthCaches } from "../src/auth.js";
import { applicableBudgets } from "../src/budgets.js";
import { buildApp, MemoryEnvelopeStore } from "../src/index.js";
import { writeMetering } from "../src/metering.js";
import type { GatewayConfig } from "../src/types.js";

const databaseUrl =
  process.env.DATABASE_URL ?? "postgres://facility:facility@localhost:5461/facility_gw";
const orgId = "org_dev_the_agile_monkeys";
const masterKey = Buffer.alloc(32, 7).toString("base64");

type StubState = {
  anthropicCalls: number;
  openaiCalls: number;
  lastOpenAiRequest: unknown;
  abortObserved: boolean;
};

async function canConnect() {
  const client = postgres(databaseUrl, { max: 1, connect_timeout: 2 });
  try {
    await client`select 1`;
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

describe("gateway", async () => {
  const reachable = await canConnect();
  if (!reachable) {
    it.skip("Postgres is unreachable at DATABASE_URL; gateway integration tests skipped", () =>
      undefined);
    return;
  }

  const { db, client } = createDb(databaseUrl);
  const envelopes = new MemoryEnvelopeStore();
  const stubState: StubState = {
    anthropicCalls: 0,
    openaiCalls: 0,
    lastOpenAiRequest: null,
    abortObserved: false,
  };
  let stub: FastifyInstance;
  let gateway: FastifyInstance;
  let gatewayOrigin = "";
  let stubOrigin = "";

  beforeAll(async () => {
    await migrate(databaseUrl);
    await seed(databaseUrl);
    stub = await buildStub(stubState);
    await stub.listen({ port: 0, host: "127.0.0.1" });
    stubOrigin = `http://127.0.0.1:${(stub.server.address() as { port: number }).port}`;
    const config: GatewayConfig = {
      databaseUrl,
      secretMasterKey: masterKey,
      port: 4410,
      logLevel: "silent",
      facilityInsecureDev: true,
    };
    gateway = await buildApp(config, { db, envelopeStore: envelopes });
    await gateway.listen({ port: 0, host: "127.0.0.1" });
    gatewayOrigin = `http://127.0.0.1:${(gateway.server.address() as { port: number }).port}`;
  });

  beforeEach(async () => {
    clearAuthCaches();
    stubState.anthropicCalls = 0;
    stubState.openaiCalls = 0;
    stubState.lastOpenAiRequest = null;
    stubState.abortObserved = false;
    envelopes.objects.clear();
    await db.delete(llmRequests).where(eq(llmRequests.orgId, orgId));
    await db.delete(spendCounters).where(eq(spendCounters.orgId, orgId));
    await db.delete(platformIssues).where(eq(platformIssues.orgId, orgId));
    await db.delete(providerCredentials).where(eq(providerCredentials.orgId, orgId));
    await db.delete(llmRequests).where(eq(llmRequests.orgId, orgId));
    await db.delete(virtualKeys).where(eq(virtualKeys.orgId, orgId));
    await db.delete(budgets).where(eq(budgets.orgId, orgId));
  });

  afterAll(async () => {
    await gateway.close();
    await stub.close();
    await client.end();
  });

  it("1. Anthropic non-stream roundtrip meters tokens, cost, and spend", async () => {
    const setup = await setupVirtualKey({
      provider: "anthropic",
      baseUrl: `${stubOrigin}/anthropic/v1`,
    });
    const response = await postAnthropic(setup.secret, {
      model: "claude-sonnet-5",
      messages: [{ role: "user", content: "hello" }],
    });
    expect(response.status).toBe(200);
    await waitForRequestCount(1);
    const row = (
      await db.select().from(llmRequests).where(eq(llmRequests.virtualKeyId, setup.keyId))
    )[0];
    expect(row?.inputTokens).toBe(1_000_000);
    expect(row?.outputTokens).toBe(1_000_000);
    expect(row?.costCents).toBe(1800);
    const counter = (
      await db.select().from(spendCounters).where(eq(spendCounters.budgetId, setup.budgetId))
    )[0];
    const charged = (
      await db
        .select()
        .from(llmRequests)
        .where(and(eq(llmRequests.virtualKeyId, setup.keyId), eq(llmRequests.status, "ok")))
    )[0];
    expect(counter?.spentCents).toBeCloseTo(charged?.costCents ?? 0, 6);
  });

  it("2. Anthropic SSE chunks pass through byte-exact and store an envelope", async () => {
    const setup = await setupVirtualKey({
      provider: "anthropic",
      baseUrl: `${stubOrigin}/anthropic/v1`,
    });
    const response = await postAnthropic(setup.secret, {
      model: "claude-sonnet-5",
      stream: true,
      messages: [{ role: "user", content: "hello" }],
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(anthropicSseBody());
    await waitForRequestCount(1);
    expect([...envelopes.objects.keys()][0]).toContain(`envelopes/${orgId}/`);
    const row = (
      await db.select().from(llmRequests).where(eq(llmRequests.virtualKeyId, setup.keyId))
    )[0];
    expect(row?.outputTokens).toBe(1_000_000);
  });

  it("3. OpenAI streaming injects include_usage but stores the original request", async () => {
    const setup = await setupVirtualKey({ provider: "openai", baseUrl: `${stubOrigin}/openai/v1` });
    const response = await postOpenAi(setup.secret, {
      model: "gpt-5.5-mini",
      stream: true,
      messages: [{ role: "user", content: "hello" }],
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("data: [DONE]");
    expect(
      (stubState.lastOpenAiRequest as { stream_options?: { include_usage?: boolean } })
        .stream_options?.include_usage,
    ).toBe(true);
    await waitForRequestCount(1);
    const stored = [...envelopes.objects.values()][0] as {
      request: { body: { stream_options?: unknown } };
    };
    expect(stored.request.body.stream_options).toBeUndefined();
    const row = (
      await db.select().from(llmRequests).where(eq(llmRequests.virtualKeyId, setup.keyId))
    )[0];
    expect(row?.costCents).toBe(225);
  });

  it("4. Hard budget exceeded returns 402 and skips upstream", async () => {
    const setup = await setupVirtualKey({
      provider: "anthropic",
      baseUrl: `${stubOrigin}/anthropic/v1`,
      budgetMode: "hard",
      budgetLimitCents: 0,
    });
    const response = await postAnthropic(setup.secret, { model: "claude-sonnet-5", messages: [] });
    expect(response.status).toBe(402);
    expect(await response.json()).toMatchObject({ error: { type: "budget_exceeded" } });
    expect(stubState.anthropicCalls).toBe(0);
    await waitForRequestCount(1);
    const row = (
      await db.select().from(llmRequests).where(eq(llmRequests.virtualKeyId, setup.keyId))
    )[0];
    expect(row?.status).toBe("blocked_budget");
  });

  it("5. Soft budget breach allows and dedupes a platform issue", async () => {
    const setup = await setupVirtualKey({
      provider: "anthropic",
      baseUrl: `${stubOrigin}/anthropic/v1`,
      budgetMode: "soft",
      budgetLimitCents: 0,
    });
    expect(
      (await postAnthropic(setup.secret, { model: "claude-sonnet-5", messages: [] })).status,
    ).toBe(200);
    expect(
      (await postAnthropic(setup.secret, { model: "claude-sonnet-5", messages: [] })).status,
    ).toBe(200);
    const issues = await db.select().from(platformIssues).where(eq(platformIssues.orgId, orgId));
    expect(issues).toHaveLength(1);
    expect(issues[0]?.fingerprint).toContain(setup.budgetId);
  });

  it("6. allowed_models violation returns 403 blocked_policy", async () => {
    const setup = await setupVirtualKey({
      provider: "openai",
      baseUrl: `${stubOrigin}/openai/v1`,
      allowedModels: ["gpt-5.5-mini"],
    });
    const response = await postOpenAi(setup.secret, { model: "gpt-5.5", messages: [] });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { type: "blocked_policy" } });
    expect(stubState.openaiCalls).toBe(0);
    await waitForRequestCount(1);
  });

  it("6b. unpriced models fail closed before upstream unless the key is explicit zero-cost", async () => {
    const blocked = await setupVirtualKey({
      provider: "anthropic",
      baseUrl: `${stubOrigin}/anthropic/v1`,
    });
    const blockedResponse = await postAnthropic(blocked.secret, {
      model: "future-expensive-model",
      messages: [],
    });
    expect(blockedResponse.status).toBe(402);
    expect(await blockedResponse.json()).toMatchObject({ error: { type: "model_not_priced" } });
    expect(stubState.anthropicCalls).toBe(0);
    await waitForRequestCount(1);
    const blockedRow = (
      await db.select().from(llmRequests).where(eq(llmRequests.virtualKeyId, blocked.keyId))
    )[0];
    expect(blockedRow?.status).toBe("model_not_priced");
    expect(blockedRow?.priced).toBe(false);

    await db.delete(llmRequests).where(eq(llmRequests.orgId, orgId));
    await db.delete(providerCredentials).where(eq(providerCredentials.orgId, orgId));
    const byo = await setupVirtualKey({
      provider: "anthropic",
      baseUrl: `${stubOrigin}/anthropic/v1`,
      allowedModels: ["byo-model"],
      budgetMode: "hard",
      budgetLimitCents: 0,
    });
    const allowedResponse = await postAnthropic(byo.secret, {
      model: "byo-model",
      messages: [],
    });
    expect(allowedResponse.status).toBe(200);
    expect(stubState.anthropicCalls).toBe(1);
    await waitForRequestCount(1);
    const byoRow = (
      await db.select().from(llmRequests).where(eq(llmRequests.virtualKeyId, byo.keyId))
    )[0];
    expect(byoRow?.costCents).toBe(0);
    expect(byoRow?.priced).toBe(false);
  });

  it("6c. hard budget reservation blocks a concurrent over-limit request", async () => {
    const setup = await setupVirtualKey({
      provider: "anthropic",
      baseUrl: `${stubOrigin}/anthropic/v1`,
      budgetMode: "hard",
      budgetLimitCents: 1800,
    });
    const first = postAnthropic(setup.secret, {
      model: "claude-sonnet-5",
      max_tokens: 1_000_000,
      slow: true,
      messages: [],
    });
    await waitFor(() => stubState.anthropicCalls === 1);
    const second = await postAnthropic(setup.secret, {
      model: "claude-sonnet-5",
      max_tokens: 1_000_000,
      messages: [],
    });
    expect(second.status).toBe(402);
    expect(await second.json()).toMatchObject({ error: { type: "budget_exceeded" } });
    expect(stubState.anthropicCalls).toBe(1);
    expect((await first).status).toBe(200);
    await waitForRequestCount(2);
    const counter = (
      await db.select().from(spendCounters).where(eq(spendCounters.budgetId, setup.budgetId))
    )[0];
    expect(counter?.spentCents).toBe(1800);
  });

  it("6d. tiny sub-cent calls accumulate fractional spend", async () => {
    const setup = await setupVirtualKey({
      provider: "anthropic",
      baseUrl: `${stubOrigin}/anthropic/v1`,
      budgetLimitCents: 100_000,
    });
    for (let index = 0; index < 5; index += 1) {
      const response = await postAnthropic(setup.secret, {
        model: "claude-fable-5",
        max_tokens: 1,
        tinyUsage: true,
        messages: [{ role: "user", content: "x" }],
      });
      expect(response.status).toBe(200);
    }
    await waitForRequestCount(5);
    const rows = await db
      .select()
      .from(llmRequests)
      .where(eq(llmRequests.virtualKeyId, setup.keyId));
    expect(rows).toHaveLength(5);
    expect(rows[0]?.costCents).toBeGreaterThan(0);
    expect(rows[0]?.costCents).toBeLessThan(1);
    const counter = (
      await db.select().from(spendCounters).where(eq(spendCounters.budgetId, setup.budgetId))
    )[0];
    expect(counter?.spentCents).toBeCloseTo(0.045, 6);
  });

  it("6d2. duplicate metering for one request id does not double-charge or erase charged cost", async () => {
    const setup = await setupVirtualKey({
      provider: "anthropic",
      baseUrl: `${stubOrigin}/anthropic/v1`,
      budgetLimitCents: 100_000,
    });
    const key = {
      id: setup.keyId,
      orgId,
      projectId: setup.projectId,
      runId: null,
      taskId: null,
      allowedModels: null,
      budgetId: setup.budgetId,
      agentDefId: null,
    };
    const meteringNow = new Date("2026-07-05T00:00:00.000Z");
    const budgetStates = await applicableBudgets(db, key, meteringNow);
    const requestId = newId("evt");
    await writeMetering(
      db,
      envelopes,
      gateway.log,
      {
        requestId,
        provider: "anthropic",
        model: "claude-sonnet-5",
        status: "ok",
        statusCode: 200,
        startedAt: Date.now(),
        key,
        usage: {
          inputTokens: 1_000_000,
          outputTokens: 1_000_000,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
        priced: true,
        requestBody: { messages: [] },
        responseBody: { usage: "charged" },
        budgets: budgetStates,
      },
      meteringNow,
    );
    await writeMetering(
      db,
      envelopes,
      gateway.log,
      {
        requestId,
        provider: "anthropic",
        model: "claude-sonnet-5",
        status: "error",
        statusCode: 500,
        startedAt: Date.now(),
        key,
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
        priced: true,
        requestBody: { messages: [] },
        responseBody: { error: "duplicate retry" },
        budgets: budgetStates,
        estimatedCents: 10,
        providerMayHaveCharged: true,
      },
      meteringNow,
    );

    const rows = await db.select().from(llmRequests).where(eq(llmRequests.id, requestId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("ok");
    expect(rows[0]?.costCents).toBe(1800);
    const counter = (
      await db.select().from(spendCounters).where(eq(spendCounters.budgetId, setup.budgetId))
    )[0];
    expect(counter?.spentCents).toBe(1800);
  });

  it("6d3. logs envelope storage failures but keeps the metering row", async () => {
    const setup = await setupVirtualKey({
      provider: "anthropic",
      baseUrl: `${stubOrigin}/anthropic/v1`,
      budgetLimitCents: 100_000,
    });
    const key = {
      id: setup.keyId,
      orgId,
      projectId: setup.projectId,
      runId: null,
      taskId: null,
      allowedModels: null,
      budgetId: setup.budgetId,
      agentDefId: null,
    };
    const logger = { ...gateway.log, warn: vi.fn() } as typeof gateway.log;
    const requestId = newId("evt");
    await writeMetering(
      db,
      {
        putEnvelope: async () => {
          throw new Error("bucket unavailable");
        },
      },
      logger,
      {
        requestId,
        provider: "anthropic",
        model: "claude-fable-5",
        status: "ok",
        statusCode: 200,
        startedAt: Date.now(),
        key,
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
        priced: true,
        requestBody: { messages: [] },
        responseBody: { id: "response" },
        budgets: [],
      },
      new Date("2026-07-05T00:00:00.000Z"),
    );

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ requestId, err: expect.any(Error) }),
      "gateway envelope storage failed; recording metering without envelope URI",
    );
    const row = (await db.select().from(llmRequests).where(eq(llmRequests.id, requestId)))[0];
    expect(row?.requestUri).toBeNull();
    expect(row?.responseUri).toBeNull();
    expect(row?.costCents).toBeGreaterThan(0);
  });

  it("6e. hard budget reservation includes input exposure before upstream", async () => {
    const setup = await setupVirtualKey({
      provider: "anthropic",
      baseUrl: `${stubOrigin}/anthropic/v1`,
      budgetMode: "hard",
      budgetLimitCents: 1,
    });
    const response = await postAnthropic(setup.secret, {
      model: "claude-fable-5",
      max_tokens: 1,
      messages: [{ role: "user", content: "x".repeat(4_000) }],
    });
    expect(response.status).toBe(402);
    expect(await response.json()).toMatchObject({ error: { type: "budget_exceeded" } });
    expect(stubState.anthropicCalls).toBe(0);
    await waitForRequestCount(1);
    const row = (
      await db.select().from(llmRequests).where(eq(llmRequests.virtualKeyId, setup.keyId))
    )[0];
    expect(row?.status).toBe("blocked_budget");
  });

  it("7. Revoked key and unknown prefix both return provider-shaped 401", async () => {
    const setup = await setupVirtualKey({
      provider: "anthropic",
      baseUrl: `${stubOrigin}/anthropic/v1`,
      revoked: true,
    });
    const revoked = await postAnthropic(setup.secret, { model: "claude-sonnet-5", messages: [] });
    const unknown = await postAnthropic("fvk_00000000ffffffffffffffffffffffffffffffffffffffff", {
      model: "claude-sonnet-5",
      messages: [],
    });
    expect(revoked.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(await revoked.json()).toMatchObject({ error: { type: "unauthorized" } });
    expect(await unknown.json()).toMatchObject({ error: { type: "unauthorized" } });
  });

  it("8. Upstream 500 status and body pass through and meter as error", async () => {
    const setup = await setupVirtualKey({ provider: "openai", baseUrl: `${stubOrigin}/openai/v1` });
    const response = await postOpenAi(setup.secret, {
      model: "gpt-5.5-mini",
      force500: true,
      messages: [],
    });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: { message: "upstream exploded" } });
    await waitForRequestCount(1);
    const row = (
      await db.select().from(llmRequests).where(eq(llmRequests.virtualKeyId, setup.keyId))
    )[0];
    expect(row?.status).toBe("error");
    const counter = (
      await db.select().from(spendCounters).where(eq(spendCounters.budgetId, setup.budgetId))
    )[0];
    expect(counter?.spentCents).toBeGreaterThan(0);
  });

  it("9. Client abort aborts upstream and records partial usage", async () => {
    const setup = await setupVirtualKey({
      provider: "anthropic",
      baseUrl: `${stubOrigin}/anthropic/v1`,
    });
    const controller = new AbortController();
    const response = await fetch(`${gatewayOrigin}/anthropic/v1/messages`, {
      method: "POST",
      headers: { "x-api-key": setup.secret, "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        abortStream: true,
        stream: true,
        messages: [],
      }),
      signal: controller.signal,
    });
    await response.body?.getReader().read();
    controller.abort();
    await waitFor(() => stubState.abortObserved);
    await waitForRequestCount(1);
    const row = (
      await db.select().from(llmRequests).where(eq(llmRequests.virtualKeyId, setup.keyId))
    )[0];
    expect(row?.outputTokens).toBe(333);
    const counter = (
      await db.select().from(spendCounters).where(eq(spendCounters.budgetId, setup.budgetId))
    )[0];
    expect(counter?.spentCents).toBeGreaterThan(0);
  });

  it("9b. rejects private BYO provider base URLs before upstream fetch", async () => {
    const setup = await setupVirtualKey({
      provider: "anthropic",
      baseUrl: "https://169.254.169.254/v1",
    });
    const response = await postAnthropic(setup.secret, {
      model: "claude-sonnet-5",
      messages: [],
    });
    expect(response.status).toBe(502);
    expect(stubState.anthropicCalls).toBe(0);
    await waitForRequestCount(1);
    const row = (
      await db.select().from(llmRequests).where(eq(llmRequests.virtualKeyId, setup.keyId))
    )[0];
    expect(row?.status).toBe("error");
    expect(row?.error).toBe("upstream fetch failed");
    const counter = (
      await db.select().from(spendCounters).where(eq(spendCounters.budgetId, setup.budgetId))
    )[0];
    expect(counter?.spentCents ?? 0).toBe(0);
  });

  it("9c. hard budget reservation includes cache read/write exposure", async () => {
    const setup = await setupVirtualKey({
      provider: "anthropic",
      baseUrl: `${stubOrigin}/anthropic/v1`,
      budgetMode: "hard",
      budgetLimitCents: 1_000,
    });
    const response = await postAnthropic(setup.secret, {
      model: "claude-fable-5",
      max_tokens: 1,
      estimated_cache_write_tokens: 1_000_000,
      messages: [],
    });
    expect(response.status).toBe(402);
    expect(stubState.anthropicCalls).toBe(0);
    await waitForRequestCount(1);
    const row = (
      await db.select().from(llmRequests).where(eq(llmRequests.virtualKeyId, setup.keyId))
    )[0];
    expect(row?.status).toBe("blocked_budget");
  });

  it("10. Stub p95 latency overhead stays below 50ms", async () => {
    const setup = await setupVirtualKey({ provider: "openai", baseUrl: `${stubOrigin}/openai/v1` });
    await postOpenAi(setup.secret, { model: "gpt-5.5-mini", messages: [] });
    const samples: number[] = [];
    for (let index = 0; index < 20; index += 1) {
      const start = performance.now();
      const response = await postOpenAi(setup.secret, { model: "gpt-5.5-mini", messages: [] });
      expect(response.status).toBe(200);
      samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    expect(samples[Math.floor(samples.length * 0.95)] ?? 999).toBeLessThan(50);
  });

  async function setupVirtualKey(input: {
    provider: "anthropic" | "openai";
    baseUrl: string;
    allowedModels?: string[];
    budgetMode?: "soft" | "hard";
    budgetLimitCents?: number;
    revoked?: boolean;
  }) {
    const project = (
      await db
        .insert(projects)
        .values({
          id: newId("proj"),
          orgId,
          name: "Gateway Test",
          slug: `gw-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          settings: {},
        })
        .returning()
    )[0];
    if (!project) throw new Error("project setup failed");
    await db.insert(providerCredentials).values({
      id: newId("int"),
      orgId,
      provider: input.provider,
      name: "default",
      baseUrl: input.baseUrl,
      sealedSecret: await seal(`real-${input.provider}`, masterKey),
      createdBy: "test",
    });
    const budget = (
      await db
        .insert(budgets)
        .values({
          id: newId("bud"),
          orgId,
          scope: "project",
          projectId: project.id,
          period: "daily",
          limitCents: input.budgetLimitCents ?? 100_000,
          mode: input.budgetMode ?? "hard",
          enabled: true,
        })
        .returning()
    )[0];
    const key = await generateApiKey("fvk");
    await db.insert(virtualKeys).values({
      id: key.id,
      orgId,
      projectId: project.id,
      name: "test key",
      prefix: key.lookup,
      last4: key.last4,
      hash: key.hash,
      allowedModels: input.allowedModels,
      budgetId: budget?.id,
      revokedAt: input.revoked ? new Date() : null,
    });
    return { secret: key.secret, keyId: key.id, budgetId: budget?.id ?? "", projectId: project.id };
  }

  async function postAnthropic(secret: string, body: unknown) {
    return fetch(`${gatewayOrigin}/anthropic/v1/messages`, {
      method: "POST",
      headers: {
        "x-api-key": secret,
        "content-type": "application/json",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });
  }

  async function postOpenAi(secret: string, body: unknown) {
    return fetch(`${gatewayOrigin}/openai/v1/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async function waitForRequestCount(count: number) {
    await waitFor(async () => {
      const rows = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(llmRequests)
        .where(and(eq(llmRequests.orgId, orgId), ne(llmRequests.status, "reserved")));
      return (rows[0]?.count ?? 0) >= count;
    });
  }
});

async function waitFor(predicate: () => boolean | Promise<boolean>) {
  const started = Date.now();
  while (Date.now() - started < 2_000) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("timed out waiting for condition");
}

async function buildStub(state: StubState) {
  const app = Fastify({ logger: false });

  app.post("/anthropic/v1/messages", async (request, reply) => {
    state.anthropicCalls += 1;
    expect(request.headers["x-api-key"]).toBe("real-anthropic");
    const body = request.body as {
      model: string;
      stream?: boolean;
      abortStream?: boolean;
      tinyUsage?: boolean;
    };
    if ((body as { slow?: boolean }).slow) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (body.abortStream) {
      reply.raw.on("close", () => {
        state.abortObserved = true;
      });
      reply.raw.writeHead(200, { "content-type": "text/event-stream" });
      reply.raw.write(
        'event: message_delta\ndata: {"type":"message_delta","delta":{"usage":{"output_tokens":333}}}\n\n',
      );
      await new Promise((resolve) => setTimeout(resolve, 10_000));
      return reply;
    }
    if (body.stream) {
      reply.raw.writeHead(200, { "content-type": "text/event-stream" });
      reply.raw.end(anthropicSseBody());
      return reply;
    }
    return {
      id: "msg_stub",
      type: "message",
      content: [{ type: "text", text: "ok" }],
      usage: {
        input_tokens: body.tinyUsage ? 1 : 1_000_000,
        output_tokens: body.tinyUsage ? 1 : 1_000_000,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    };
  });

  app.post("/openai/v1/chat/completions", async (request, reply) => {
    state.openaiCalls += 1;
    expect(request.headers.authorization).toBe("Bearer real-openai");
    const body = request.body as { model: string; stream?: boolean; force500?: boolean };
    state.lastOpenAiRequest = body;
    if (body.force500) {
      return reply.status(500).send({ error: { message: "upstream exploded" } });
    }
    if (body.stream) {
      reply.raw.writeHead(200, { "content-type": "text/event-stream" });
      reply.raw.end(
        [
          'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n',
          'data: {"choices":[],"usage":{"input_tokens":1000000,"output_tokens":1000000}}\n\n',
          "data: [DONE]\n\n",
        ].join(""),
      );
      return reply;
    }
    return {
      id: "chatcmpl_stub",
      choices: [{ message: { role: "assistant", content: "ok" } }],
      usage: { input_tokens: 1_000_000, output_tokens: 1_000_000 },
    };
  });

  app.post("/openai/v1/responses", async () => ({
    id: "resp_stub",
    output: [],
    usage: { input_tokens: 1_000_000, output_tokens: 1_000_000 },
  }));

  return app;
}

function anthropicSseBody() {
  return [
    'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":1000000}}}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"text":"ok"}}\n\n',
    'event: message_delta\ndata: {"type":"message_delta","delta":{"usage":{"output_tokens":1000000}}}\n\n',
  ].join("");
}
