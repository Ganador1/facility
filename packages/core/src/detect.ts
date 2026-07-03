export type DetectionInput = {
  files: Map<string, string> | Record<string, string>;
  defaultBranch?: string;
  org?: string;
};

export type RepoDetection = {
  isGitRepo: boolean;
  defaultBranch: string;
  packageManager: "pnpm" | "yarn" | "npm" | "none";
  checks: string[];
  provision: string;
  org: string;
  workflowNames: string[];
  suggestedModules: string[];
  existing: {
    agentsMd: boolean;
    claudeMd: boolean;
    claudeSettings: boolean;
    standard: boolean;
  };
};

function lookup(files: Map<string, string> | Record<string, string>) {
  return files instanceof Map ? files : new Map(Object.entries(files));
}

function readJson<T>(content: string | undefined): T | null {
  if (!content) return null;
  try {
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

export function detectFromFiles(input: DetectionInput): RepoDetection {
  const files = lookup(input.files);
  const pkg = readJson<{ scripts?: Record<string, string> }>(files.get("package.json"));
  const scripts = pkg?.scripts ?? {};
  const packageManager = files.has("pnpm-lock.yaml")
    ? "pnpm"
    : files.has("yarn.lock")
      ? "yarn"
      : files.has("package-lock.json")
        ? "npm"
        : pkg
          ? "npm"
          : "none";
  const runner =
    packageManager === "none"
      ? null
      : packageManager === "npm"
        ? "npm run"
        : `${packageManager} run`;
  const checks: string[] = [];
  if (runner) {
    for (const name of ["typecheck", "lint", "test", "build"]) {
      if (scripts[name]) checks.push(`${runner} ${name}`);
    }
  }
  const workflowNames: string[] = [];
  for (const [path, content] of files) {
    const match = path.match(/^\.github\/workflows\/([^/]+\.ya?ml)$/);
    if (!match || match[1]?.startsWith("facility-")) continue;
    const nameMatch = content.match(/^name:\s*["']?([^"'\n]+)["']?\s*$/m);
    if (nameMatch?.[1]) workflowNames.push(nameMatch[1].trim());
  }
  const migrationDirs = [
    "migrations",
    "supabase/migrations",
    "db/migrations",
    "prisma/migrations",
  ].filter((dir) => [...files.keys()].some((path) => path.startsWith(`${dir}/`)));
  return {
    isGitRepo: true,
    defaultBranch: input.defaultBranch ?? "main",
    packageManager,
    checks,
    provision: runner && scripts.setup ? `${runner} setup` : "",
    org: input.org ?? "",
    workflowNames,
    suggestedModules: migrationDirs.length ? ["database"] : [],
    existing: {
      agentsMd: files.has("AGENTS.md"),
      claudeMd: files.has("CLAUDE.md"),
      claudeSettings: files.has(".claude/settings.json"),
      standard: files.has("STANDARD.md"),
    },
  };
}
