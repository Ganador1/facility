// Stack detection: read the target repo and propose sensible defaults so
// `init` asks six short questions instead of twenty.
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function git(cwd, args) {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

export function detect(dir) {
  const pkg = readJson(join(dir, "package.json"));
  const scripts = pkg?.scripts ?? {};

  const packageManager = existsSync(join(dir, "pnpm-lock.yaml"))
    ? "pnpm"
    : existsSync(join(dir, "yarn.lock"))
      ? "yarn"
      : existsSync(join(dir, "package-lock.json"))
        ? "npm"
        : pkg
          ? "npm"
          : "none";

  const runner = packageManager === "none" ? null : packageManager === "npm" ? "npm run" : `${packageManager} run`;
  const checks = [];
  if (runner) {
    for (const name of ["typecheck", "lint", "test", "build"]) {
      if (scripts[name]) checks.push(`${runner} ${name}`);
    }
  }

  const provision = runner && scripts["setup"] ? `${runner} setup` : "";

  const isGitRepo = git(dir, ["rev-parse", "--is-inside-work-tree"]) === "true";
  let defaultBranch = "main";
  const originHead = git(dir, ["symbolic-ref", "refs/remotes/origin/HEAD"]);
  if (originHead) defaultBranch = originHead.replace("refs/remotes/origin/", "");
  else {
    const current = git(dir, ["branch", "--show-current"]);
    if (current) defaultBranch = current;
  }

  let org = "";
  const remote = git(dir, ["remote", "get-url", "origin"]);
  const remoteMatch = remote.match(/[/:]([^/:]+)\/([^/]+?)(\.git)?$/);
  if (remoteMatch) org = remoteMatch[1];

  const migrationDirs = ["migrations", "supabase/migrations", "db/migrations", "prisma/migrations"].filter((d) =>
    existsSync(join(dir, d))
  );

  return {
    isGitRepo,
    defaultBranch,
    packageManager,
    checks,
    provision,
    org,
    suggestedModules: migrationDirs.length ? ["database"] : [],
    existing: {
      agentsMd: existsSync(join(dir, "AGENTS.md")),
      claudeMd: existsSync(join(dir, "CLAUDE.md")),
      claudeSettings: existsSync(join(dir, ".claude/settings.json")),
      standard: existsSync(join(dir, "STANDARD.md")),
    },
  };
}
