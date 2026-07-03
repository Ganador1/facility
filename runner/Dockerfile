FROM node:22-bookworm

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ripgrep ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Pinned 2026-07-03 after `npm view`: claude-code 2.1.199, codex 0.142.5.
RUN npm i -g @anthropic-ai/claude-code@2.1.199 @openai/codex@0.142.5

WORKDIR /app
COPY package.json tsconfig.json ./
COPY src ./src
RUN npm install && npm run build && npm prune --omit=dev

# Run non-root: agent CLIs (Claude Code) refuse bypass-permissions as root, and
# a rogue agent process should never hold uid 0. The base image ships a `node`
# user (uid 1000); /work is the agent's writable home + workspace.
RUN mkdir -p /work && chown -R node:node /work /app
USER node
ENV HOME=/work
WORKDIR /work
ENTRYPOINT ["node", "/app/dist/index.js"]
