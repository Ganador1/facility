import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { newId } from "@facility/core";
import { createDb } from "@facility/db";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { uuidv7 } from "uuidv7";
import { authenticateVirtualKey, providerCredential, virtualKeyFromHeaders } from "./auth.js";
import { modelFrom, prepareOpenAiBody, readJsonBody, sanitizedRequest } from "./body.js";
import { applicableBudgets, emitSoftBudgetIssues, hardBudgetBlock } from "./budgets.js";
import { readConfig } from "./config.js";
import { createEnvelopeStore } from "./envelope-store.js";
import { GatewayError, providerEnvelope, sendProviderError } from "./errors.js";
import { enqueueMetering } from "./metering.js";
import type { GatewayConfig, GatewayDeps, Provider, RequestRecord, Usage } from "./types.js";
import { emptyUsage, UsageTee, usageFromJson } from "./usage.js";

const allowedPaths = {
  anthropic: new Set(["/messages", "/messages/count_tokens"]),
  openai: new Set(["/chat/completions", "/responses"]),
} satisfies Record<Provider, Set<string>>;

export async function buildApp(
  config: GatewayConfig = readConfig(),
  deps: GatewayDeps = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: config.logLevel },
    genReqId: () => uuidv7(),
    bodyLimit: 20 * 1024 * 1024,
  });
  app.removeAllContentTypeParsers();
  app.addContentTypeParser("*", (_request, payload, done) => done(null, payload));
  const owned = deps.db ? null : createDb(config.databaseUrl);
  const db = deps.db ?? owned?.db;
  if (!db) throw new Error("gateway database unavailable");
  const envelopeStore = deps.envelopeStore ?? createEnvelopeStore(config);
  const now = deps.now ?? (() => new Date());

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof GatewayError) return sendProviderError(reply, error);
    const message = error instanceof Error ? error.message : "Internal error";
    return reply.status(500).send({ error: { code: "internal_error", message } });
  });

  app.get("/health", async () => {
    try {
      await db.execute("select 1" as never);
      return { ok: true, db: "ok" as const };
    } catch {
      return { ok: false, db: "down" as const };
    }
  });

  app.post("/anthropic/v1/*", (request, reply) =>
    handleProvider(request, reply, "anthropic", config, db, envelopeStore, now),
  );
  app.post("/openai/v1/*", (request, reply) =>
    handleProvider(request, reply, "openai", config, db, envelopeStore, now),
  );

  app.addHook("onClose", async () => {
    await owned?.client.end();
  });

  return app;
}

async function handleProvider(
  request: FastifyRequest,
  reply: FastifyReply,
  provider: Provider,
  config: GatewayConfig,
  db: NonNullable<GatewayDeps["db"]>,
  envelopeStore: NonNullable<GatewayDeps["envelopeStore"]>,
  now: () => Date,
) {
  const suffix = providerSuffix(request, provider);
  if (!allowedPaths[provider].has(suffix)) {
    throw new GatewayError(404, "not_found", "Provider path not supported", provider);
  }
  const startedAt = Date.now();
  const requestId = newId("evt");
  const secret = virtualKeyFromHeaders(request.headers);
  if (!secret) {
    throw new GatewayError(401, "unauthorized", "Invalid virtual key", provider);
  }
  const key = await authenticateVirtualKey(db, secret);
  if (!key) {
    throw new GatewayError(401, "unauthorized", "Invalid virtual key", provider);
  }

  let parsed: { raw: Buffer; json: unknown };
  try {
    parsed = await readJsonBody(request.body);
  } catch {
    throw new GatewayError(
      400,
      "bad_request",
      "Request body must be valid JSON under 20MB",
      provider,
    );
  }
  const model = modelFrom(parsed.json);
  if (!model) {
    throw new GatewayError(400, "bad_request", "Request body must include model", provider);
  }
  const budgets = await applicableBudgets(db, key, now());
  const hardBlock = hardBudgetBlock(budgets);
  const recordedBody =
    provider === "openai" ? prepareOpenAiBody(parsed.json).recordedBody : parsed.json;
  const requestBody = sanitizedRequest(recordedBody, request.headers);

  if (hardBlock) {
    const responseBody = providerEnvelope(
      provider,
      "blocked_budget",
      `Budget ${hardBlock.id} is exhausted. Request an override in /inbox/budget_override.`,
    );
    const record = baseRecord({
      requestId,
      provider,
      model,
      status: "blocked_budget",
      statusCode: 402,
      startedAt,
      key,
      requestBody,
      responseBody,
      budgets,
      error: `hard budget ${hardBlock.id} exceeded`,
    });
    enqueueMetering(db, envelopeStore, request.log, record, now());
    return reply.status(402).send(responseBody);
  }

  if (key.allowedModels?.length && !key.allowedModels.includes(model)) {
    const responseBody = providerEnvelope(
      provider,
      "blocked_policy",
      `Model ${model} is not allowed for this virtual key.`,
    );
    const record = baseRecord({
      requestId,
      provider,
      model,
      status: "blocked_policy",
      statusCode: 403,
      startedAt,
      key,
      requestBody,
      responseBody,
      budgets,
      error: "allowed_models violation",
    });
    enqueueMetering(db, envelopeStore, request.log, record, now());
    return reply.status(403).send(responseBody);
  }

  await emitSoftBudgetIssues(db, budgets, key);
  const credential = await providerCredential(db, config, provider, key.orgId);
  const upstreamBody = provider === "openai" ? prepareOpenAiBody(parsed.json).raw : parsed.raw;
  const upstreamHeaders = providerHeaders(
    provider,
    request.headers,
    credential.apiKey,
    upstreamBody,
  );
  const controller = new AbortController();
  reply.raw.on("close", () => {
    if (!reply.raw.writableEnded) controller.abort();
  });

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl(credential.baseUrl, suffix, request.url), {
      method: "POST",
      headers: upstreamHeaders,
      body: upstreamBody,
      signal: controller.signal,
    });
  } catch (error) {
    const record = baseRecord({
      requestId,
      provider,
      model,
      status: "error",
      statusCode: 502,
      startedAt,
      key,
      requestBody,
      responseBody: { error: error instanceof Error ? error.message : "upstream fetch failed" },
      budgets,
      error: "upstream fetch failed",
    });
    enqueueMetering(db, envelopeStore, request.log, record, now());
    throw new GatewayError(502, "provider_error", "Upstream provider request failed", provider);
  }

  copyHeaders(upstream, reply);
  reply.status(upstream.status);
  const contentType = upstream.headers.get("content-type") ?? undefined;
  const tee = new UsageTee(provider);
  let responseBody: unknown = {};
  let usage: Usage = emptyUsage();
  let status: RequestRecord["status"] = upstream.ok ? "ok" : "error";
  let error: string | undefined = upstream.ok ? undefined : `upstream status ${upstream.status}`;

  try {
    if (upstream.body) {
      await pipeline(Readable.fromWeb(upstream.body), tee, reply.raw);
    } else {
      reply.raw.end();
    }
    responseBody = tee.responseBody(contentType);
    usage = mergeParsedUsage(tee.usage, usageFromJson(provider, responseBody));
  } catch (pipelineError) {
    status = "error";
    error = pipelineError instanceof Error ? pipelineError.message : "stream interrupted";
    responseBody = tee.responseBody(contentType);
    usage = tee.usage;
  } finally {
    const record = baseRecord({
      requestId,
      provider,
      model,
      status,
      statusCode: upstream.status,
      startedAt,
      key,
      usage,
      requestBody,
      responseBody,
      budgets,
      error,
    });
    enqueueMetering(db, envelopeStore, request.log, record, now());
  }
}

function baseRecord(input: Omit<RequestRecord, "usage"> & { usage?: Usage }): RequestRecord {
  return { ...input, usage: input.usage ?? emptyUsage() };
}

function mergeParsedUsage(base: Usage, parsed: Partial<Usage>): Usage {
  return {
    inputTokens: parsed.inputTokens ?? base.inputTokens,
    outputTokens: parsed.outputTokens ?? base.outputTokens,
    cacheReadTokens: parsed.cacheReadTokens ?? base.cacheReadTokens,
    cacheWriteTokens: parsed.cacheWriteTokens ?? base.cacheWriteTokens,
  };
}

function providerSuffix(request: FastifyRequest, provider: Provider): string {
  const prefix = provider === "anthropic" ? "/anthropic/v1" : "/openai/v1";
  const path = request.url.split("?")[0] ?? request.url;
  return path.slice(prefix.length);
}

function upstreamUrl(baseUrl: string, suffix: string, originalUrl: string): string {
  const query = originalUrl.includes("?") ? `?${originalUrl.split("?").slice(1).join("?")}` : "";
  return `${baseUrl.replace(/\/$/, "")}${suffix}${query}`;
}

function providerHeaders(
  provider: Provider,
  incoming: Record<string, unknown>,
  apiKey: string,
  body: Buffer,
): Headers {
  const headers = new Headers();
  headers.set("content-type", "application/json");
  headers.set("content-length", String(body.length));
  const userAgent = incoming["user-agent"];
  if (typeof userAgent === "string") headers.set("user-agent", userAgent);
  if (provider === "anthropic") {
    headers.set("x-api-key", apiKey);
    const version = incoming["anthropic-version"];
    if (typeof version === "string") headers.set("anthropic-version", version);
    // Pass provider feature headers through — a transparent proxy must not
    // strip beta flags the client set (e.g. Claude Code's context_management),
    // or the upstream rejects the body fields those flags enable.
    const beta = incoming["anthropic-beta"];
    if (typeof beta === "string") headers.set("anthropic-beta", beta);
  } else {
    headers.set("authorization", `Bearer ${apiKey}`);
    const openaiBeta = incoming["openai-beta"];
    if (typeof openaiBeta === "string") headers.set("openai-beta", openaiBeta);
  }
  return headers;
}

function copyHeaders(upstream: Response, reply: FastifyReply) {
  for (const [name, value] of upstream.headers) {
    if (["connection", "content-length", "keep-alive", "transfer-encoding"].includes(name)) {
      continue;
    }
    reply.header(name, value);
  }
}
