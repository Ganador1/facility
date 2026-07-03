// `facility init` — install the method into a repository.
//
// Detect the stack, ask six short questions, write the files, print the
// manual steps that only a human can do. Every generated file belongs to the
// target repo afterwards; facility is the installer, not a runtime dependency.
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
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
    "      # facility: no Node toolchain detected. Add your language setup steps",
    "      # here (compilers, package managers) so the crew can build and test.",
    "",
  ].join("\n");
}

function boardStep(org, projectNumber) {
  if (!projectNumber) return "";
  return [
    "",
    "      # Reflect the invoked agent on the org Project board:",
    "      #   /architect -> Planning, /builder -> In Progress (accepting the plan).",
    "      # Forward-only; no-ops if PROJECTS_PAT is unset (the default",
    "      # GITHUB_TOKEN cannot write org Projects v2).",
    "      - name: Move Project board status",
    "        if: >",
    "          steps.requested-agent.outputs.run == 'true' &&",
    "          (github.event_name == 'issues' ||",
    "          (github.event_name == 'issue_comment' && github.event.issue.pull_request == null))",
    "        env:",
    "          GH_TOKEN: ${{ secrets.PROJECTS_PAT }}",
    "          MODE: ${{ steps.requested-agent.outputs.mode }}",
    "          ISSUE_NODE_ID: ${{ github.event.issue.node_id }}",
    `          ORG: '${org}'`,
    `          PROJECT_NUMBER: '${projectNumber}'`,
    "        run: bash .github/facility/move-board-status.sh",
    "",
  ].join("\n");
}

function doctorWatch(workflowNames) {
  const watched = [...new Set([...workflowNames, "facility-review"])];
  const lines = watched.map((name) => `      - ${name}`);
  if (workflowNames.length === 0) {
    lines.unshift("      # facility: no existing check workflows detected at init time —");
    lines.unshift("      # add your CI workflow names here so the doctor watches them.");
  }
  return lines.join("\n");
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
    warn(`${dir} is not a git repository. Run \`git init\` first — facility installs GitHub workflows.`);
    if (interactive && !(await confirm("Continue anyway?", false))) {
      closePrompts();
      return 1;
    }
  }

  heading("Detected");
  item(`package manager   ${bold(detected.packageManager)}`);
  item(`default branch    ${bold(detected.defaultBranch)}`);
  item(`checks            ${detected.checks.length ? bold(detected.checks.join(", ")) : dim("none found")}`);
  item(`check workflows   ${detected.workflowNames.length ? bold(detected.workflowNames.join(", ")) : dim("none — the doctor watch list starts empty")}`);
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
  // Model tiering is an opinionated default, not a question: deep reasoning
  // where it matters, volume where it doesn't. Override with
  // --build-model / --review-model / --plan-model.
  const models = {
    build: flags["build-model"] || "opusplan",
    review: flags["review-model"] || "claude-sonnet-4-6",
    plan: flags["plan-model"] || "claude-opus-4-8",
  };
  item(dim(`model tiering: ${models.build} build · ${models.review} review · ${models.plan} plan/repair/sweep`));
  const canaryBot = flags["canary-bot"] || "facility-canary[bot]";
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
    'echo "facility: no provision command configured — the crew runs on a bare checkout. Set one in this workflow + .facility.json."';
  const checksInline = checks.length ? checks.join(" ; ") : "the checks configured in STANDARD.md";

  // The canary hash is derived from the canonical probe body so the crew
  // workflow, the canary script, and the watchtower-locked guard can never
  // drift apart at generation time.
  const { CANARY_PROBE_BODY } = await import(
    pathToFileURL(join(pkgRoot, "templates/watchtower/canary.mjs")).href
  );
  const canarySha256 = createHash("sha256").update(CANARY_PROBE_BODY.replace(/\r/g, ""), "utf8").digest("hex");

  const vars = {
    FACILITY_VERSION: version,
    DEFAULT_BRANCH: defaultBranch,
    BUILD_MODEL: models.build,
    REVIEW_MODEL: models.review,
    PLAN_MODEL: models.plan,
    PROVISION_CMD: provisionCmd,
    CHECKS_INLINE: checksInline,
    CHECKS_LIST: checksList(checks),
    ALLOW_CHECKS_JSON: checksAllowJson(checks),
    TOOLCHAIN_STEPS: toolchainSteps(detected.packageManager),
    TOOLCHAIN_STEPS_CONDITIONAL: toolchainSteps(detected.packageManager, { conditional: true }),
    BOARD_STEP: boardStep(org, project),
    CANARY_BOT: canaryBot,
    CANARY_SHA256: canarySha256,
    DOCTOR_WATCH: doctorWatch(detected.workflowNames),
  };

  const template = (relPath) => readFileSync(join(pkgRoot, "templates", relPath), "utf8");
  const plan = [
    { to: ".github/workflows/facility-crew.yml", content: render(template("workflows/facility-crew.yml"), vars) },
    { to: ".github/workflows/facility-review.yml", content: render(template("workflows/facility-review.yml"), vars) },
    { to: ".github/workflows/facility-address-review.yml", content: render(template("workflows/facility-address-review.yml"), vars) },
    { to: ".github/workflows/facility-doctor.yml", content: render(template("workflows/facility-doctor.yml"), vars) },
    { to: ".github/workflows/facility-security-sweep.yml", content: render(template("workflows/facility-security-sweep.yml"), vars) },
    { to: ".github/workflows/facility-watchtower.yml", content: render(template("workflows/facility-watchtower.yml"), vars) },
    { to: ".github/workflows/facility-canary.yml", content: render(template("workflows/facility-canary.yml"), vars) },
    { to: ".github/facility/architect.md", content: render(template("prompts/architect.md"), vars) },
    { to: ".github/facility/builder.md", content: render(template("prompts/builder.md"), vars) },
    { to: ".github/facility/doctor.md", content: render(template("prompts/doctor.md"), vars) },
    { to: ".github/facility/sweep.md", content: render(template("prompts/sweep.md"), vars) },
    { to: ".github/facility/doctor/resolve.mjs", content: template("doctor/resolve.mjs") },
    { to: ".github/facility/watchtower/outcomes.mjs", content: template("watchtower/outcomes.mjs") },
    { to: ".github/facility/watchtower/health.mjs", content: template("watchtower/health.mjs") },
    { to: ".github/facility/watchtower/canary.mjs", content: template("watchtower/canary.mjs") },
    { to: ".github/facility/watchtower/budgets.json", content: template("watchtower/budgets.json") },
    { to: ".github/facility/move-board-status.sh", content: template("scripts/move-board-status.sh"), executable: true },
    { to: "STANDARD.md", content: render(template("standard/STANDARD.md"), vars) },
    { to: ".claude/settings.json", content: render(template("claude/settings.json"), vars) },
    { to: ".claude/hooks/protect-branch.mjs", content: render(template("claude/hooks/protect-branch.mjs"), vars) },
    { to: ".claude/hooks/protect-files.mjs", content: template("claude/hooks/protect-files.mjs") },
    { to: ".claude/agents/standards-reviewer.md", content: template("claude/agents/standards-reviewer.md") },
    { to: ".claude/agents/security-reviewer.md", content: template("claude/agents/security-reviewer.md") },
    { to: ".claude/skills/working-to-standard/SKILL.md", content: template("claude/skills/working-to-standard/SKILL.md") },
    { to: ".claude/skills/reviewing-to-standard/SKILL.md", content: template("claude/skills/reviewing-to-standard/SKILL.md") },
    { to: ".claude/skills/maintainable-software/SKILL.md", content: template("claude/skills/maintainable-software/SKILL.md") },
    { to: ".claude/commands/verify.md", content: render(template("claude/commands/verify.md"), vars) },
    { to: ".claude/commands/open-pr.md", content: render(template("claude/commands/open-pr.md"), vars) },
    { to: "guards/run.mjs", content: template("guards/run.mjs") },
    { to: "guards/_kit.mjs", content: template("guards/_kit.mjs") },
    { to: "guards/actions-pinned.mjs", content: template("guards/actions-pinned.mjs") },
    { to: "guards/watchtower-locked.mjs", content: template("guards/watchtower-locked.mjs") },
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
      ok(`${entry} (facility block appended)`);
      written += 1;
    } else {
      skip(`${entry} already has a facility block`);
    }
  }

  // Cross-tool: non-Claude agents discover the same skills via .agents/skills.
  const agentsSkillsLink = join(dir, ".agents/skills");
  try {
    lstatSync(agentsSkillsLink);
    skip(".agents/skills exists — left untouched");
  } catch {
    try {
      mkdirSync(join(dir, ".agents"), { recursive: true });
      symlinkSync("../.claude/skills", agentsSkillsLink, "dir");
      ok(".agents/skills → .claude/skills");
    } catch {
      warn(".agents/skills symlink could not be created (filesystem without symlink support) — skipped.");
    }
  }

  const manifest = {
    facility: version,
    engine: "claude",
    defaultBranch,
    provision: provision || null,
    checks,
    models,
    canaryBot,
    board: project ? { org, project: Number(project) } : null,
    modules: [],
  };
  writeFileSync(join(dir, ".facility.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  ok(".facility.json");

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
    `If your tests need provider keys, put TEST-tier, spend-capped keys in a ${bold("facility-crew")} Environment — never production keys.`
  );
  steps.push(
    `Optional, for the weekly canary: create a small GitHub App, install it on the repo, set ${bold("CANARY_APP_ID")} + ${bold("CANARY_APP_PRIVATE_KEY")} in the facility-crew Environment, and re-run init with --canary-bot=<your-app>[bot] (comments posted with GITHUB_TOKEN trigger nothing). It skips politely until then.`
  );
  steps.push(`Commit, push, open an issue, and comment ${accent("/architect")} on it. That's the whole onboarding.`);
  steps.push(
    `The watchtower starts reporting on its own: nightly outcomes on the ${bold("facility-watchtower")} dashboard issue, daily health with budgets from .github/facility/watchtower/budgets.json.`
  );
  steps.forEach((step, index) => item(`${bold(String(index + 1) + ".")} ${step}`));
  console.log("");
  item(dim(`${written} files written. Read STANDARD.md next — it is yours now.`));
  console.log("");

  closePrompts();
  return 0;
}
