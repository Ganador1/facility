# Multi-stage build for the Facility platform services.
# One image, selectable entrypoint (api | worker | gateway) via the APP arg /
# the start command. Web and docs build separately (Next standalone / static).
#
#   docker build --target api     -t facility/api .
#   docker build --target gateway -t facility/gateway .
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

# --- deps: install with the full workspace manifest set for cache reuse ---
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/sdk/package.json packages/sdk/
COPY services/api/package.json services/api/
COPY services/gateway/package.json services/gateway/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter '@facility/core...' \
      --filter '@facility/db...' --filter '@facility/sdk...' \
      --filter '@facility/api...' --filter '@facility/gateway...'

# --- build TS to dist ---
FROM deps AS build
COPY packages ./packages
COPY services ./services
COPY tsconfig.base.json ./
RUN pnpm --filter '@facility/core' --filter '@facility/db' --filter '@facility/sdk' \
      --filter '@facility/api' --filter '@facility/gateway' run build

# --- api (also serves the worker via `node dist/worker.js`) ---
FROM base AS api
ENV NODE_ENV=production
COPY --from=build /app /app
EXPOSE 4400
CMD ["node", "services/api/dist/server.js"]

# --- gateway ---
FROM base AS gateway
ENV NODE_ENV=production
COPY --from=build /app /app
EXPOSE 4410
CMD ["node", "services/gateway/dist/server.js"]
