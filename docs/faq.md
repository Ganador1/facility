# FAQ

## GitHub already lets me assign issues to Claude, Codex, or Copilot. Why this?

Agent HQ answers "how do I run an agent on an issue". Capataz answers what
hits you the week after: the agent ships plans instead of code because it
cannot verify anything; PRs merge on vibes because the review step has no
standard to enforce; nobody wrote down who approves what. Capataz is the
method layer — provisioned verification, a binding standard, deterministic
guards, human-owned transitions. It rides on top of whatever execution
substrate wins; today that's `claude-code-action`, and the engine seam in
`.capataz.json` exists so it doesn't have to stay the only one.

## How is this different from GitHub Agentic Workflows (gh-aw)?

gh-aw is a compiler: Markdown in, hardened workflow out. It is mechanism, and
good mechanism. It has no opinion about *what* your SDLC should be — roles,
board semantics, quality contracts, the verification ladder, what humans must
own. Capataz is those opinions, packaged. If gh-aw becomes the best way to
execute them, Capataz should compile to it rather than compete with it.

## Why does everything get vendored into my repo?

Because your SDLC configuration should not have a runtime dependency on us.
After `init`, every file is yours: readable in your repo, reviewable in your
PRs, editable without forking anything. The CLI is an installer, not a
framework. The cost is that updates are not automatic — `capataz update` is
on the roadmap, and the `.capataz.json` manifest exists so it can diff what
you have against what's current.

## Why can't the agents merge? They wrote the code and the checks pass.

Because the merge is where accountability lives. The crew makes the work
cheap; it does not make the judgment optional. The day an agent-authored
change breaks production, "a human read it and signed off" is the difference
between an incident and a crisis of the whole approach. Protect your default
branch so this is enforced by GitHub, not by trust in a prompt.

## What does it cost to run?

Each crew invocation is a GitHub Actions job (most of it: your provision
command) plus Claude usage under your subscription via the OAuth token.
The review workflow caps at 20 turns; crew runs are bounded by the job
timeout. The real cost driver is invoking /builder before the plan is good —
which is exactly what the /architect column is for.

## My tests need API keys. Where do they go?

In the `capataz-crew` GitHub Environment, as dedicated TEST-tier keys with
spend caps — never production keys. An unset secret resolves to empty and
simply disables that integration's tests. The agent runs on an ephemeral
runner with `bypassPermissions`; treat every key you give it as exposed to
the code in your repo.

## Does this work for non-Node projects?

Yes. The CLI and the vendored guards need Node on the runner (present on all
GitHub-hosted runners) — your project doesn't. `init` detects pnpm/yarn/npm
and otherwise leaves a marked slot for your toolchain steps. The provision
command is yours: `make db`, `docker compose up -d`, `mix ecto.setup`.

## Can I use my existing AGENTS.md / CLAUDE.md / .claude setup?

Yes. `init` never overwrites: it appends a managed block to existing
AGENTS.md/CLAUDE.md, skips an existing `.claude/settings.json`, and leaves
any file it finds in place (`--force` to override). `capataz doctor` tells
you what state you're in.

## Why "capataz"?

/ka·pa·TAS/ — Spanish for the person who runs a construction crew on behalf
of the owner. The architect plans, the builders build, the inspections check
the work against the building code, and the owner signs. Your repo already
had the metaphor; we just named it.
