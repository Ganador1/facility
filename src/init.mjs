// `capataz init` — install the method into a repository.
//
// Detect the stack, ask six short questions, write the files, print the
// manual steps that only a human can do. Every generated file belongs to the
// target repo afterwards; capataz is the installer, not a runtime dependency.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { detect } from "./detect.mjs";
import { render, hasManagedBlock, appendManagedBlock } from "./render.mjs";
import { ask, confirm, closePrompts } from "./prompts.mjs";
import { addModule } from "./add.mjs";
import { accent, banner, bold, dim, heading, item, ok, skip, warn } from "./ui.mjs";

const CHECKOUT_SHA = "34e114876b0b11c390a56381ad16ebd13914f8d5"; // actions/checkout v4
const SETUP_NODE_SHA = "49933ea5288caeca8642d1e84afbd3f7d6820020"; // actions/setup-node v4
const PNPM_SHA = "b906affcce14559ad1aafd4ab0e942779e9f58b1"; // pnpm/action-setup v4

function toolchainSteps(packageManager, { conditional = false } = {}) {
  const guard = conditional ? "\n        if: steps.workflow-change.outputs.changed != 'true'" : "";
  if (packageManager === "pnpm") {
    return [
      "",
      `      - uses: pnpm/action-setup@${PNPM_SHA} # v4${guard}`,
      "",
      `      - uses: actions/setup-node@${SETUP_NODE_SHA} # v4${guard}`,
      "        with:",
      "          node-version: 22",
      "          cache: pnpm",
      "",
      `      - run: pnpm install --frozen-lockfile${guard}`,
      "",
    ].join("\n");
  }
  if (packageManager === "yarn" || packageManager === "npm") {
    const installCmd = packageManager === "yarn" ? "yarn install --immutable" : "npm ci";
    return [
      "",
      `      - uses: actions/setup-node@${SETUP_NODE_SHA} # v4${guard}`,
      "        with:",
      "          node-version: 22",
      `          cache: ${packageManager}`,
      "",
      `      - run: ${installCmd}${guard}`,
      "",
    ].join("\n");
  }
  return [
    "",
    "      # capataz: no Node toolchain detected. Add your language setup steps",
    "      # here (compilers, package managers) so the crew can build and test.",
    "",
  ].join("\n");
}

function boardStep(org, projectNumber) {
  if (!projectNumber) return "";
  return [
    "",
    "      # Reflect the invoked agent on the org Project board:",
    "      #   @architect -> Planning, @builder -> In Progress (accepting the plan).",
    "      # Forward-only; no-ops if PROJECTS_PAT is unset (the default",
    "      # GITHUB_TOKEN cannot write org Projects v2).",
    "      - name: Move Project board status",
    "        if: >",
    "          github.event_name == 'issues' ||",
    "          (github.event_name == 'issue_comment' && github.event.issue.pull_request == null)",
    "        env:",
    "          GH_TOKEN: ${{ secrets.PROJECTS_PAT }}",
    "          MODE: ${{ steps.requested-agent.outputs.mode }}",
    "          ISSUE_NODE_ID: ${{ github.event.issue.node_id }}",
    `          ORG: '${org}'`,
    `          PROJECT_NUMBER: '${projectNumber}'`,
    "        run: bash .github/capataz/move-board-status.sh",
    "",
  ].join("\n");
}

function checksAllowJson(checks) {
  if (!checks.length) return "";
  return checks.map((c) => `"Bash(${c})",`).join("\n      ");
}

function checksList(checks) {
  const lines = checks.length
    ? checks.map((c) => `- \`${c}\``)
    : ["- _No check commands configured yet — add your typecheck/lint/test/build commands here._"];
  lines.push("- `node guards/run.mjs` — deterministic repo invariants. Always cheap; always run.");
  lines.push("");
  lines.push(
    "Escalate beyond this list when the change touches data, auth, or critical user flows — and say which extra checks ran."
  );
  return lines.join("\n");
}

export async function init(flags, pkgRoot, version) {
  const dir = flags.dir || process.cwd();
  const interactive = !flags.yes;

  banner(version);

  const detected = detect(dir);
  if (!detected.isGitRepo) {
    warn(`${dir} is not a git repository. Run \`git init\` first — capataz installs GitHub workflows.`);
    if (interactive && !(await confirm("Continue anyway?", false))) {
      closePrompts();
      return 1;
    }
  }

  heading("Detected");
  item(`package manager   ${bold(detected.packageManager)}`);
  item(`default branch    ${bold(detected.defaultBranch)}`);
  item(`checks            ${detected.checks.length ? bold(detected.checks.join(", ")) : dim("none found")}`);
  if (detected.suggestedModules.length) item(`suggested modules ${bold(detected.suggestedModules.join(", "))}`);

  heading("A few questions");
  const defaultBranch = flags.branch || (interactive ? await ask("Default branch?", detected.defaultBranch) : detected.defaultBranch);
  const provision =
    flags.provision ??
    (interactive
      ? await ask("Provision command (DB, seeds, browsers — what the crew runs before working)?", detected.provision)
      : detected.provision);
  const checksRaw =
    flags.checks ??
    (interactive
      ? await ask("Check commands, comma-separated?", detected.checks.join(", "))
      : detected.checks.join(", "));
  const checks = checksRaw.split(",").map((c) => c.trim()).filter(Boolean);
  const model = flags.model || (interactive ? await ask("Claude model for the crew?", "claude-opus-4-8") : "claude-opus-4-8");
  const project =
    flags.project ??
    (interactive
      ? await ask("Org Project number for board moves (empty to skip)?", "")
      : "");
  const org = project ? flags.org || (interactive ? await ask("GitHub org for the Project board?", detected.org) : detected.org) : "";
  const modulesRaw =
    flags.modules ??
    (interactive
      ? await ask("Modules to install now (analytics, database, ai-queryability, design-system)?", detected.suggestedModules.join(", "))
      : detected.suggestedModules.join(", "));
  const modules = modulesRaw.split(",").map((m) => m.trim()).filter(Boolean);

  const provisionCmd =
    provision ||
    'echo "capataz: no provision command configured — the crew runs on a bare checkout. Set one in this workflow + .capataz.json."';
  const checksInline = checks.length ? checks.join(" ; ") : "the checks configured in STANDARD.md";

  const vars = {
    CAPATAZ_VERSION: version,
    DEFAULT_BRANCH: defaultBranch,
    MODEL: model,
    PROVISION_CMD: provisionCmd,
    CHECKS_INLINE: checksInline,
    CHECKS_LIST: checksList(checks),
    ALLOW_CHECKS_JSON: checksAllowJson(checks),
    TOOLCHAIN_STEPS: toolchainSteps(detected.packageManager),
    TOOLCHAIN_STEPS_CONDITIONAL: toolchainSteps(detected.packageManager, { conditional: true }),
    BOARD_STEP: boardStep(org, project),
  };

  const template = (relPath) => readFileSync(join(pkgRoot, "templates", relPath), "utf8");
  const plan = [
    { to: ".github/workflows/capataz-crew.yml", content: render(template("workflows/capataz-crew.yml"), vars) },
    { to: ".github/workflows/capataz-review.yml", content: render(template("workflows/capataz-review.yml"), vars) },
    { to: ".github/workflows/capataz-address-review.yml", content: render(template("workflows/capataz-address-review.yml"), vars) },
    { to: ".github/capataz/architect.md", content: render(template("prompts/architect.md"), vars) },
    { to: ".github/capataz/builder.md", content: render(template("prompts/builder.md"), vars) },
    { to: ".github/capataz/move-board-status.sh", content: template("scripts/move-board-status.sh"), executable: true },
    { to: "STANDARD.md", content: render(template("standard/STANDARD.md"), vars) },
    { to: ".claude/settings.json", content: render(template("claude/settings.json"), vars) },
    { to: ".claude/hooks/protect-branch.mjs", content: render(template("claude/hooks/protect-branch.mjs"), vars) },
    { to: ".claude/hooks/protect-files.mjs", content: template("claude/hooks/protect-files.mjs") },
    { to: ".claude/agents/standards-reviewer.md", content: template("claude/agents/standards-reviewer.md") },
    { to: ".claude/agents/security-reviewer.md", content: template("claude/agents/security-reviewer.md") },
    { to: "guards/run.mjs", content: template("guards/run.mjs") },
    { to: "guards/_kit.mjs", content: template("guards/_kit.mjs") },
    { to: "guards/actions-pinned.mjs", content: template("guards/actions-pinned.mjs") },
    { to: "guards/README.md", content: template("guards/README.md") },
  ];

  heading("Writing");
  let written = 0;
  for (const file of plan) {
    const target = join(dir, file.to);
    if (existsSync(target) && !flags.force) {
      skip(`${file.to} exists — left untouched`);
      continue;
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.content);
    if (file.executable) chmodSync(target, 0o755);
    ok(file.to);
    written += 1;
  }

  // AGENTS.md / CLAUDE.md get a managed block, never an overwrite.
  const agentsBlock = render(template("standard/agents-block.md"), vars);
  for (const entry of ["AGENTS.md", "CLAUDE.md"]) {
    const target = join(dir, entry);
    if (!existsSync(target)) {
      writeFileSync(target, entry === "CLAUDE.md" ? `Follow AGENTS.md.\n\n${agentsBlock}` : `# Agent instructions\n\n${agentsBlock}`);
      ok(entry);
      written += 1;
    } else if (!hasManagedBlock(readFileSync(target, "utf8"))) {
      writeFileSync(target, appendManagedBlock(readFileSync(target, "utf8"), agentsBlock));
      ok(`${entry} (capataz block appended)`);
      written += 1;
    } else {
      skip(`${entry} already has a capataz block`);
    }
  }

  const manifest = {
    capataz: version,
    engine: "claude",
    defaultBranch,
    provision: provision || null,
    checks,
    model,
    board: project ? { org, project: Number(project) } : null,
    modules: [],
  };
  writeFileSync(join(dir, ".capataz.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  ok(".capataz.json");

  for (const moduleName of modules) {
    await addModule(moduleName, { dir, pkgRoot, banner: false });
  }

  heading("Done. The steps only you can do:");
  const steps = [
    `Create the agent token:  ${accent("claude setup-token")}  then  ${accent("gh secret set CLAUDE_CODE_OAUTH_TOKEN")}`,
    `Install the Claude GitHub App on the repo (github.com/apps/claude) so crew pushes re-trigger CI.`,
    `Protect ${bold(defaultBranch)}: require a PR and one human review. The crew never merges; this makes it structural.`,
  ];
  if (project) {
    steps.push(`Add a ${bold("PROJECTS_PAT")} secret (org Projects read+write) so the crew moves the board. It no-ops until then.`);
  }
  steps.push(
    `If your tests need provider keys, put TEST-tier, spend-capped keys in a ${bold("capataz-crew")} Environment — never production keys.`
  );
  steps.push(`Commit, push, open an issue, and comment ${accent("@architect")} on it. That's the whole onboarding.`);
  steps.forEach((step, index) => item(`${bold(String(index + 1) + ".")} ${step}`));
  console.log("");
  item(dim(`${written} files written. Read STANDARD.md next — it is yours now.`));
  console.log("");

  closePrompts();
  return 0;
}
