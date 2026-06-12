import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { lstatSync, mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(pkgRoot, "bin", "capataz.mjs");

function makeTargetRepo() {
  const dir = mkdtempSync(join(tmpdir(), "capataz-test-"));
  execFileSync("git", ["init", "-b", "main"], { cwd: dir });
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify(
      {
        name: "demo-app",
        private: true,
        scripts: { lint: "eslint .", test: "vitest run", setup: "docker compose up -d" },
      },
      null,
      2
    )
  );
  writeFileSync(join(dir, "package-lock.json"), "{}");
  return dir;
}

function runCli(args, cwd) {
  return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8" });
}

test("init installs the method end to end", async (t) => {
  const dir = makeTargetRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const result = runCli(
    [
      "init",
      "--yes",
      `--dir=${dir}`,
      "--provision=npm run setup",
      '--checks=npm run lint, npm test',
      "--org=acme",
      "--project=7",
    ],
    dir
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);

  const expected = [
    ".github/workflows/capataz-crew.yml",
    ".github/workflows/capataz-review.yml",
    ".github/workflows/capataz-address-review.yml",
    ".github/capataz/architect.md",
    ".github/capataz/builder.md",
    ".github/capataz/move-board-status.sh",
    "STANDARD.md",
    "AGENTS.md",
    "CLAUDE.md",
    ".claude/settings.json",
    ".claude/hooks/protect-branch.mjs",
    ".claude/hooks/protect-files.mjs",
    ".claude/agents/standards-reviewer.md",
    ".claude/agents/security-reviewer.md",
    ".claude/skills/working-to-standard/SKILL.md",
    ".claude/skills/reviewing-to-standard/SKILL.md",
    ".claude/skills/maintainable-software/SKILL.md",
    ".claude/commands/verify.md",
    ".claude/commands/open-pr.md",
    "guards/run.mjs",
    "guards/_kit.mjs",
    "guards/actions-pinned.mjs",
    ".capataz.json",
  ];
  for (const file of expected) {
    assert.ok(existsSync(join(dir, file)), `missing ${file}`);
  }

  // Our placeholders are gone; GitHub Actions expressions survive.
  const crew = readFileSync(join(dir, ".github/workflows/capataz-crew.yml"), "utf8");
  assert.ok(!/\{\{[A-Z0-9_]+\}\}/.test(crew), "unrendered capataz placeholder in crew workflow");
  assert.ok(crew.includes("${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}"), "GitHub expression was mangled");
  assert.ok(crew.includes("npm run setup"), "provision command not rendered");
  assert.ok(crew.includes("PROJECT_NUMBER: '7'"), "board step not rendered");
  assert.ok(crew.includes("npm ci"), "toolchain steps not rendered for npm");

  // Agent triggers are slash commands, never @-mentions (real GitHub users),
  // and bot-authored events can't summon the crew.
  assert.ok(crew.includes("trigger_phrase=/builder"), "builder trigger must be slash syntax");
  assert.ok(crew.includes("github.event.sender.type != 'Bot'"), "crew must refuse bot-authored events");
  const crewCodeLines = crew.split("\n").filter((line) => !line.trim().startsWith("#"));
  assert.ok(
    !crewCodeLines.some((line) => /@(builder|architect)\b/.test(line)),
    "no @-mention handles may remain outside explanatory comments"
  );

  // settings.json must be valid JSON with the checks allowlisted.
  const settings = JSON.parse(readFileSync(join(dir, ".claude/settings.json"), "utf8"));
  assert.ok(settings.permissions.allow.includes("Bash(npm run lint)"));
  assert.ok(settings.permissions.deny.includes("Read(.env)"));

  // STANDARD.md carries the verification ladder and the module markers.
  const standard = readFileSync(join(dir, "STANDARD.md"), "utf8");
  assert.ok(standard.includes("`npm run lint`"));
  assert.ok(standard.includes("<!-- capataz:modules:start -->"));

  // Skills are cross-tool: .agents/skills symlinks to .claude/skills, and
  // the slash commands carry the rendered verification ladder.
  assert.ok(lstatSync(join(dir, ".agents/skills")).isSymbolicLink(), ".agents/skills must be a symlink");
  assert.ok(existsSync(join(dir, ".agents/skills/working-to-standard/SKILL.md")), "symlink must resolve to the skills");
  const verifyCmd = readFileSync(join(dir, ".claude/commands/verify.md"), "utf8");
  assert.ok(verifyCmd.includes("`npm run lint`"), "verify command must carry the rendered checks");

  // Manifest reflects the choices.
  const manifest = JSON.parse(readFileSync(join(dir, ".capataz.json"), "utf8"));
  assert.equal(manifest.board.project, 7);
  assert.deepEqual(manifest.checks, ["npm run lint", "npm test"]);

  // Generated guards pass on the generated workflows (all actions pinned).
  const guards = spawnSync(process.execPath, ["guards/run.mjs"], { cwd: dir, encoding: "utf8" });
  assert.equal(guards.status, 0, guards.stdout + guards.stderr);

  // Init is idempotent: a second run skips, never overwrites.
  const again = runCli(["init", "--yes", `--dir=${dir}`, "--provision=npm run setup"], dir);
  assert.equal(again.status, 0);
  assert.ok(again.stdout.includes("left untouched"), "second init should skip existing files");
});

test("add database module wires the triple", async (t) => {
  const dir = makeTargetRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  runCli(["init", "--yes", `--dir=${dir}`, "--provision=npm run setup", "--checks=npm test"], dir);
  const result = runCli(["add", "database", `--dir=${dir}`], dir);
  assert.equal(result.status, 0, result.stdout + result.stderr);

  // 1. Prose: STANDARD.md section inside the markers.
  const standard = readFileSync(join(dir, "STANDARD.md"), "utf8");
  assert.ok(standard.includes("### Database (capataz module)"));
  const start = standard.indexOf("<!-- capataz:modules:start -->");
  const end = standard.indexOf("<!-- capataz:modules:end -->");
  assert.ok(standard.indexOf("### Database") > start && standard.indexOf("### Database") < end);

  // 2. Reviewer subagent and slash command copied.
  assert.ok(existsSync(join(dir, ".claude/agents/data-security-reviewer.md")));
  assert.ok(existsSync(join(dir, ".claude/commands/new-migration.md")));

  // 3. Checks: guard copied and hook rules spliced.
  assert.ok(existsSync(join(dir, "guards/migrations-immutable.mjs")));
  const hook = readFileSync(join(dir, ".claude/hooks/protect-files.mjs"), "utf8");
  assert.ok(hook.includes("capataz module: database"));
  assert.ok(hook.includes("/* capataz:module-rules */"), "marker must survive for the next module");

  // Manifest records it; adding twice is a no-op.
  const manifest = JSON.parse(readFileSync(join(dir, ".capataz.json"), "utf8"));
  assert.deepEqual(manifest.modules, ["database"]);
  const again = runCli(["add", "database", `--dir=${dir}`], dir);
  assert.equal(again.status, 0);
  const manifestAgain = JSON.parse(readFileSync(join(dir, ".capataz.json"), "utf8"));
  assert.deepEqual(manifestAgain.modules, ["database"]);

  // The spliced hook still parses.
  const parse = spawnSync(process.execPath, ["--check", ".claude/hooks/protect-files.mjs"], {
    cwd: dir,
    encoding: "utf8",
  });
  assert.equal(parse.status, 0, parse.stderr);
});

test("doctor reports missing install", async (t) => {
  const dir = makeTargetRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const result = runCli(["doctor", `--dir=${dir}`], dir);
  assert.equal(result.status, 1);
  assert.ok(result.stdout.includes("missing"));
});
