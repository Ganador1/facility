FROM node:22-bookworm

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ripgrep ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Pinned 2026-07-19 after `npm view`: claude-code 2.1.215, codex 0.144.6.
RUN npm i -g @anthropic-ai/claude-code@2.1.215 @openai/codex@0.144.6

# Create the package-manager shims while the image is still writable. Runtime
# sandboxes mount /work as a writable tmpfs and keep the image root read-only;
# baking the shims makes a later `corepack enable` idempotent instead of trying
# (and failing) to write /usr/local/bin. Package downloads still use $HOME in
# writable /work.
RUN corepack enable

WORKDIR /app
COPY package.json tsconfig.json ./
COPY src ./src
RUN npm install && npm run build && npm prune --omit=dev

# Run non-root: agent CLIs (Claude Code) refuse bypass-permissions as root, and
# a rogue agent process should never hold uid 0.
RUN mkdir -p /work && chown -R node:node /work /app
USER node
ENV HOME=/work
WORKDIR /work
ENTRYPOINT ["node", "/app/dist/index.js"]
