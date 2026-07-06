# Spec: LLM gateway (services/gateway)

**Scope**: the model-access chokepoint — one service, `@facility/gateway`. Everything an agent or product calls a model through goes here: virtual-key auth, model policy, budget enforcement, streaming passthrough, usage metering, full audit capture. Depends on `@facility/core` (pricing, crypto) and `@facility/db`.

Read first: [ARCHITECTURE.md](../ARCHITECTURE.md) §2/§5 (gateway flow), [control-plane.md](control-plane.md) (db tables: virtual_keys, provider_credentials, llm_requests, budgets, spend_counters), discovery/tam-os.md (privacy boundary).

## Behavior

Fastify 5 service, `GATEWAY_PORT` (default 4410). Two provider surfaces, path-compatible with official SDKs so `ANTHROPIC_BASE_URL` / `OPENAI_BASE_URL` pointing at the gateway Just Works:

- `POST /anthropic/v1/messages` (+ passthrough of `/anthropic/v1/messages/count_tokens`) → upstream `https://api.anthropic.com/v1/…` (or provider_credentials.base_url when set)
- `POST /openai/v1/chat/completions` and `POST /openai/v1/responses` → upstream `https://api.openai.com/v1/…` (or base_url — this is also the BYO surface: any OpenAI-compatible endpoint)
- `GET /health` → {ok, db}

**Auth**: `Authorization: Bearer fvk_…` OR `x-api-key: fvk_…` (Anthropic SDK sends x-api-key). Lookup by prefix (in-memory LRU 60s TTL) → argon2 verify → load {project, org, run?, allowed_models, budgets}. Revoked/expired → 401 envelope in the PROVIDER's error shape (Anthropic-style `{type:"error",error:{type,message}}` on /anthropic, OpenAI-style on /openai) so SDK error handling stays sane.

**Model policy**: if key.allowed_models non-empty and request.model ∉ list → 403 `blocked_policy`, recorded.

**Budgets** (fast path, no misses): resolve applicable budgets (org, project, agent via run→agent_def) from cache (30s); compute current window spend from `spend_counters`; if any HARD budget spent ≥ limit → 402 `blocked_budget` (provider-shaped error, message names the budget and the inbox path to request an override); SOFT breach → allow + emit `budget.warned` platform issue (deduped).

**Forwarding**: buffer the request body up to a 20MB cap (needed to read the model and inject OpenAI usage options — larger bodies are rejected), then forward it; inject real provider credential (sealed → opened lazily and cached in memory per `${org}:${provider}` for 60s; the api NOTIFYs `facility_provider_changed` on provider create/delete and the gateway LISTENs and evicts synchronously, so a rotated/removed credential takes effect at once — the 60s TTL is only the backstop; the parallel `facility_key_revoked` channel evicts revoked virtual keys the same way); strip the virtual key header; add `anthropic-version` passthrough. Response: stream back verbatim (SSE and non-SSE), tee-parsing usage:
- Anthropic: `message_start`/`message_delta` usage blocks (input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens) or non-stream response.usage.
- OpenAI: final chunk usage (`stream_options.include_usage` — inject it when streaming and absent; strip the injected field from the echoed request recorded in audit) or response.usage.
On client abort: abort upstream, still record partial usage if a usage frame arrived.

**Metering**: after response completes (or fails): insert `llm_requests` row {org, project, run, virtual_key, provider, model, status, tokens, cost_cents (from @facility/core pricing; null for unknown/BYO models), latency_ms, envelope URIs}; increment `spend_counters` (UPSERT window row; window = budget period start) for each applicable budget; update key last-used. Non-blocking (queue write after response flush; on write failure log + retry once — never fail the model call because metering hiccuped).

**Envelope capture** (store-everything default, org-configurable off): request + response bodies to object storage `s3://$S3_BUCKET/envelopes/{org}/{yyyy-mm}/{request_id}.json.gz` — gzip JSON {request (virtual key REDACTED, provider key never present), response (full text; for streams, the concatenated final message + usage), meta}. URIs recorded on llm_requests. Failures: log, continue.

**Privacy boundary**: run receipts remain metrics-only; envelopes are the deliberate full-capture store, access-gated by `audit:read` + project scope at the API layer (the gateway itself exposes no read endpoints).

## Config

Env (zod): `DATABASE_URL`, `SECRET_MASTER_KEY`, `GATEWAY_PORT`, `S3_*`, `LOG_LEVEL`, optional `DEV_ANTHROPIC_API_KEY`/`DEV_OPENAI_API_KEY` (dev fallback when an org has no sealed credential — dev only, refuse in production without explicit `FACILITY_INSECURE_DEV=1`).

## Mechanical floor

```
pnpm install && pnpm build && pnpm typecheck && pnpm test && pnpm lint && node guards/run.mjs
```

Tests (vitest, real Postgres; mock upstreams with a local Fastify stub that speaks both provider protocols incl. SSE):
1. Anthropic non-stream roundtrip: virtual key → 200, llm_requests row with correct tokens+cost (fixture usage), spend counter incremented.
2. Anthropic SSE stream: chunks passthrough byte-exact, usage parsed from message_delta, envelope stored (MinIO or in-memory S3 stub).
3. OpenAI stream: include_usage injected when missing, usage captured, injected flag not present in stored request envelope.
4. Hard budget exceeded → 402 provider-shaped error, no upstream call, llm_requests status blocked_budget.
5. Soft budget breach → 200 + deduped platform_issue created once.
6. allowed_models violation → 403 blocked_policy.
7. Revoked key → 401; unknown prefix → 401; timing-safe (no early return distinguishable — just assert both 401).
8. Upstream 500 passthrough: status + body relayed, llm_requests status error.
9. Client abort mid-stream: upstream aborted (stub observes), partial usage recorded if sent.
10. Latency overhead measured in test < 50ms p95 over stub (sanity, not a benchmark).

## Judgment criteria

Response streaming is zero-copy (the upstream response is piped back without full-body buffering); the REQUEST body is buffered up to the 20MB cap (needed to read the model + inject OpenAI usage options) then forwarded; provider keys only ever in gateway memory; error envelopes match each provider's SDK expectations; metering failures never break the call; budget check is one indexed query + cache, not N; no route besides the two provider surfaces + health.
