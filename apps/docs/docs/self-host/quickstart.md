---
title: Quickstart
---

# Self-host quickstart

Facility is containers + Postgres + S3-compatible storage. Nothing else.

## Development / evaluation

```bash
git clone https://github.com/theam/facility && cd facility
cp .env.example .env          # set SECRET_MASTER_KEY: openssl rand -base64 32
docker compose -f docker-compose.dev.yml up -d    # postgres + minio
pnpm install
pnpm --filter @facility/db migrate && pnpm --filter @facility/db seed
pnpm dev                       # api :4400 · gateway :4410 · web :3400
```

`pnpm dev` runs the api, gateway, and web. The **worker** (queue consumers +
crons: run dispatch, watchtower, learning) is a separate process — start it with
`node services/api/dist/worker.js` (or its dev script) so platform-lane runs
actually dispatch. In the docker-compose stack it's the dedicated `worker` service.

Open `http://localhost:3400`, sign in with **dev sign in** (enabled by
`FACILITY_INSECURE_DEV=1` — refused in production builds), and you're in the
seeded organization.

For a production-like check, issue an owner/admin API key and run:

```bash
facility doctor --url http://localhost:4400 --key fak_...
```

The command calls `/v1/admin/doctor` and prints the deployment checklist:
database and migrations, object-store envelope write/read round trip, seed
essentials, the `sandbox_runner` profile (driver + runner image, plus Docker
daemon reachability for the docker driver), production `auth_config`, GitHub App
configuration, and audit hash-chain verification.

## What's running

| service | port | role |
|---|---|---|
| `web` | 3400 | the app |
| `api` | 4400 | control plane (REST + OpenAPI at `/docs` in dev) |
| `gateway` | 4410 | LLM proxy — point `ANTHROPIC_BASE_URL` / `OPENAI_BASE_URL` here |
| worker | — | queues + crons (same image as api) |
| postgres | 5461 | the database |
| minio | 9000 | envelope/transcript storage |

The compose stack uses MinIO for envelopes and auto-creates the configured
bucket (`S3_BUCKET`, default `facility`) during startup. API and gateway sign
object-store requests with AWS SigV4, so the same settings work with MinIO,
AWS S3, R2, and other S3-compatible endpoints.

## First real steps

1. **Providers** — add your Anthropic/OpenAI keys (sealed at rest) from the web
   **Settings → providers** page, or via the v1 API (`POST /v1/providers`); there
   is not yet a dedicated CLI command.
2. **GitHub App** — create your own App installation (see
   [Production](production)) so kickstart and triggers work against your org.
3. **Kickstart** — connect a repo and open the kickstart PR.
