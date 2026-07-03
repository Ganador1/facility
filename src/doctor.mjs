// `facility doctor` — check the install and tell the truth about what's left.
// Static checks run locally; the GitHub-side items it can't verify are
// printed as the explicit manual checklist instead of being assumed.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { banner, fail, heading, item, ok, warn, dim } from "./ui.mjs";

const REQUIRED = [
  ".github/workflows/facility-crew.yml",
  ".github/workflows/facility-review.yml",
  ".github/workflows/facility-address-review.yml",
  ".github/workflows/facility-doctor.yml",
  ".github/workflows/facility-security-sweep.yml",
  ".github/workflows/facility-watchtower.yml",
  ".github/workflows/facility-canary.yml",
  ".github/facility/architect.md",
  ".github/facility/builder.md",
  ".github/facility/doctor.md",
  ".github/facility/sweep.md",
  ".github/facility/doctor/resolve.mjs",
  ".github/facility/watchtower/outcomes.mjs",
  ".github/facility/watchtower/health.mjs",
  ".github/facility/watchtower/canary.mjs",
  ".github/facility/watchtower/budgets.json",
  "STANDARD.md",
  "AGENTS.md",
  ".claude/hooks/protect-branch.mjs",
  ".claude/hooks/protect-files.mjs",
  ".claude/skills/working-to-standard/SKILL.md",
  ".claude/skills/reviewing-to-standard/SKILL.md",
  ".claude/skills/maintainable-software/SKILL.md",
  ".claude/commands/verify.md",
  "guards/run.mjs",
];

export async function doctor(flags, version) {
  const dir = flags.dir || process.cwd();
  banner(version);

  let problems = 0;

  heading("Files");
  for (const file of REQUIRED) {
    if (existsSync(join(dir, file))) ok(file);
    else {
      fail(`${file} missing — run \`npx @theam/facility init\``);
      problems += 1;
    }
  }

  heading("Manifest");
  const manifestPath = join(dir, ".facility.json");
  if (!existsSync(manifestPath)) {
    fail(".facility.json missing");
    problems += 1;
  } else {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    ok(`engine ${manifest.engine}, model ${manifest.model}`);
    if (!manifest.provision) {
      warn("no provision command configured — the crew runs on a bare checkout and WILL under-verify. Set one.");
      problems += 1;
    } else ok(`provision: ${manifest.provision}`);
    if (!manifest.checks?.length) {
      warn("no check commands configured — 'verify before done' has nothing to run.");
      problems += 1;
    } else ok(`checks: ${manifest.checks.join(", ")}`);
  }

  heading("Guards");
  if (existsSync(join(dir, "guards/run.mjs"))) {
    const result = spawnSync(process.execPath, ["guards/run.mjs"], { cwd: dir, encoding: "utf8" });
    if (result.status === 0) ok("guards pass");
    else {
      fail("guards failing:");
      console.log(
        (result.stdout + result.stderr)
          .split("\n")
          .map((line) => `      ${line}`)
          .join("\n")
      );
      problems += 1;
    }
  }

  heading("GitHub side (verify by hand or with gh)");
  const gh = spawnSync("gh", ["secret", "list"], { cwd: dir, encoding: "utf8" });
  if (gh.status === 0) {
    if (gh.stdout.includes("CLAUDE_CODE_OAUTH_TOKEN")) ok("CLAUDE_CODE_OAUTH_TOKEN secret exists");
    else {
      fail("CLAUDE_CODE_OAUTH_TOKEN secret not found — `claude setup-token`, then `gh secret set CLAUDE_CODE_OAUTH_TOKEN`");
      problems += 1;
    }
  } else {
    item(dim("could not query secrets (gh unavailable or not authenticated) — check by hand:"));
    item(dim("  · CLAUDE_CODE_OAUTH_TOKEN repo/org secret"));
  }
  item(dim("  · Claude GitHub App installed on the repo"));
  item(dim("  · default branch protected: PR + 1 human review required"));
  item(dim("  · provider TEST keys (if any) live in the facility-crew Environment"));

  console.log("");
  if (problems === 0) item(`${dim("Everything checkable checks out.")}`);
  else item(`${dim(`${problems} problem${problems === 1 ? "" : "s"} found.`)}`);
  console.log("");
  return problems === 0 ? 0 : 1;
}
