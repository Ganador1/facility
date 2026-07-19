FROM node:22-bookworm

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ripgrep ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Pinned 2026-07-19 after `npm view`: claude-code 2.1.215, codex 0.144.6.
RUN npm i -g @anthropic-ai/claude-code@2.1.215 @openai/codex@0.144.6

WORKDIR /app
COPY package.json tsconfig.json ./
COPY src ./src
RUN npm install && npm run build && npm prune --omit=dev

# Run non-root: agent CLIs (Claude Code) refuse bypass-permissions as root, and
# a rogue agent process should never hold uid 0. Corepack normally installs its
# shims beside /usr/local/bin/corepack, which is read-only to this user. Put a
# discoverable Corepack link in a writable bin directory so common provision
# commands such as `corepack enable && pnpm install` remain non-root safe.
RUN mkdir -p /work/bin \
  && ln -s "$(command -v corepack)" /work/bin/corepack \
  && printf '%s\n' 'export PATH="/work/bin:$PATH"' > /work/.bash_profile \
  && chown -R node:node /work /app
USER node
ENV HOME=/work
ENV PATH="/work/bin:${PATH}"
WORKDIR /work
ENTRYPOINT ["node", "/app/dist/index.js"]
