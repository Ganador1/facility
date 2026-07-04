import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { composedPrompt, prepareWorkspace } from "../src/index.js";
import type { RunBundle } from "../src/types.js";

function bundle(overrides: Partial<RunBundle> = {}): RunBundle {
  return {
    runId: "run_test",
    mode: "builder",
    engine: "codex",
    contract: "Do the work.",
    skills: [],
    engineConfig: {},
    repo: { cloneUrl: null, branch: null, installationTokenRef: null },
    harness: null,
    provisionCmd: null,
    checkCmds: [],
    gatewayUrls: { anthropic: "https://anthropic.test", openai: "https://openai.test" },
    scope: {},
    timeoutMin: 5,
    ...overrides,
  };
}

describe("workspace preparation", () => {
  it("writes harness files into the workspace and points the prompt at SESSION.md", async () => {
    const root = await mkdtemp(join(tmpdir(), "facility-runner-"));
    const runBundle = bundle({
      harness: {
        files: {
          "harness/SESSION.md": "# Session",
          "harness/CHARTER.md": "# Charter",
        },
      },
    });

    await prepareWorkspace(
      runBundle,
      "virtual-key",
      {
        platformKey: null,
        platformApiUrl: "https://api.test",
        projectId: "proj_test",
        repoToken: null,
      },
      root,
    );

    await expect(readFile(join(root, "scratch", "harness", "SESSION.md"), "utf8")).resolves.toBe(
      "# Session",
    );
    await expect(readFile(join(root, "scratch", "harness", "CHARTER.md"), "utf8")).resolves.toBe(
      "# Charter",
    );
    expect(composedPrompt(runBundle)).toContain(
      "Project harness/KB context is in ./harness/SESSION.md - read it first.",
    );
    expect(composedPrompt(bundle())).not.toContain("./harness/SESSION.md");
  });

  it("does not write live engine or platform key values into the agent cwd", async () => {
    const root = await mkdtemp(join(tmpdir(), "facility-runner-"));
    const previousEnv = {
      anthropic: process.env.ANTHROPIC_API_KEY,
      openai: process.env.OPENAI_API_KEY,
      platform: process.env.FACILITY_PLATFORM_KEY,
    };
    try {
      await prepareWorkspace(
        bundle(),
        "virtual-key-secret",
        {
          platformKey: "platform-key-secret",
          platformApiUrl: "https://api.test",
          projectId: "proj_test",
          repoToken: null,
        },
        root,
      );

      await expect(
        readFile(join(root, "scratch", ".facility-engine-env"), "utf8"),
      ).rejects.toThrow();
      expect(process.env.ANTHROPIC_API_KEY).toBe("virtual-key-secret");
      expect(process.env.OPENAI_API_KEY).toBe("virtual-key-secret");
      expect(process.env.FACILITY_PLATFORM_KEY).toBe("platform-key-secret");

      const files = await workspaceFiles(join(root, "scratch"));
      const contents = await Promise.all(files.map((file) => readFile(file, "utf8")));
      expect(contents.join("\n")).not.toContain("virtual-key-secret");
      expect(contents.join("\n")).not.toContain("platform-key-secret");
    } finally {
      restoreEnv("ANTHROPIC_API_KEY", previousEnv.anthropic);
      restoreEnv("OPENAI_API_KEY", previousEnv.openai);
      restoreEnv("FACILITY_PLATFORM_KEY", previousEnv.platform);
    }
  });
});

async function workspaceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await workspaceFiles(path)));
    } else {
      files.push(path);
    }
  }
  return files;
}

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
