import { execFileSync, spawn } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildClaudeCodeArgs,
  buildCodexArgs,
  composedPrompt,
  exitCode,
  handleControlMessage,
  parseGitNameStatus,
  prepareWorkspace,
  publishVerifiedGithubBranchUpdate,
  publishVerifiedGithubChanges,
  readAgentDeliveryMetadata,
  readAgentProgress,
  readAgentUpdateMetadata,
  readSecurityReport,
  requiresAgentProgress,
  semanticDeliveryBranch,
  terminateChild,
} from "../src/index.js";
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
  it("accepts only a bounded structured security findings artifact", async () => {
    const root = await mkdtemp(join(tmpdir(), "facility-runner-"));
    const path = join(root, "security-findings.json");
    await writeFile(
      path,
      JSON.stringify({
        schema: "facility.security.findings.v1",
        findings: [
          {
            fingerprint: "auth-bypass",
            title: "Authorization bypass",
            severity: "high",
            confidence: "high",
            actionable: true,
            risk: "Reachable privileged path",
            locations: ["src/admin.ts:4"],
            smallest_fix: "Apply the shared guard",
            evidence: [],
          },
        ],
        dismissed: [],
        scanners_not_enabled: [],
      }),
    );
    await expect(readSecurityReport(path)).resolves.toMatchObject({
      schema: "facility.security.findings.v1",
    });
    await writeFile(path, JSON.stringify({ schema: "wrong", findings: [] }));
    await expect(readSecurityReport(path)).resolves.toBeNull();
  });

  it("observes a child exit even when close happened before the waiter was attached", async () => {
    const child = spawn(process.execPath, ["-e", "process.exit(0)"], {
      stdio: "ignore",
    });
    await new Promise<void>((resolve) => child.once("close", () => resolve()));

    await expect(exitCode(child)).resolves.toBe(0);
  });

  it("writes harness files into the workspace and points the prompt at SESSION.md", async () => {
    const root = await mkdtemp(join(tmpdir(), "facility-runner-"));
    const runBundle = bundle({
      skills: [{ name: "validation evidence", content: "# Validation evidence" }],
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
    await expect(
      readFile(
        join(root, "scratch", ".agents", "skills", "validation_evidence", "SKILL.md"),
        "utf8",
      ),
    ).resolves.toContain(
      '---\nname: "validation_evidence"\ndescription: "Project-managed Facility skill: validation evidence"\n---\n\n# Validation evidence',
    );
    expect(composedPrompt(runBundle)).toContain(
      "Project harness/KB context is in ./harness/SESSION.md - read it first.",
    );
    expect(composedPrompt(bundle())).not.toContain("./harness/SESSION.md");
    expect(composedPrompt(bundle())).toContain(".agent-sdlc/progress.md");
    expect(composedPrompt(bundle({ mode: "custom" }))).not.toContain(".agent-sdlc/progress.md");
    expect(composedPrompt(bundle())).toContain(".agent-sdlc/delivery.json");
    expect(composedPrompt(bundle({ mode: "architect" }))).not.toContain(
      ".agent-sdlc/delivery.json",
    );
    expect(
      composedPrompt(
        bundle({
          repo: {
            cloneUrl: "https://github.com/acme/widget.git",
            branch: "main",
            installationTokenRef: "installation",
          },
        }),
      ),
    ).toContain("Never emit sandbox-local paths");
    expect(composedPrompt(bundle())).not.toContain("Never emit sandbox-local paths");
    expect(
      composedPrompt(
        bundle({ skills: [{ name: "validation evidence", content: "# Validation evidence" }] }),
      ),
    ).toContain(".agents/skills/validation_evidence/SKILL.md");
    expect(
      composedPrompt(
        bundle({ mode: "review", scope: { type: "github_event", deliveryContext: {} } }),
      ),
    ).toContain("sandbox clone credential is intentionally contents-only");
  });

  it("validates agent-owned branch, commit, and pull request metadata", async () => {
    const root = await mkdtemp(join(tmpdir(), "facility-runner-"));
    const path = join(root, "delivery.json");
    await writeFile(
      path,
      JSON.stringify({
        branch: "feature/2-integer-subtraction",
        commitMessage: "feat: add integer subtraction",
        pullRequest: {
          title: "feat: add integer subtraction",
          body: "## Summary\n- Add subtraction.\n\n## Verification\n- `pnpm test`",
        },
      }),
    );

    await expect(readAgentDeliveryMetadata(path)).resolves.toMatchObject({
      branch: "feature/2-integer-subtraction",
      commitMessage: "feat: add integer subtraction",
    });
    await writeFile(
      path,
      JSON.stringify({
        branch: "facility/run-123",
        commitMessage: "generic message",
        pullRequest: { title: "Builder result", body: "Result" },
      }),
    );
    await expect(readAgentDeliveryMetadata(path)).rejects.toThrow("branch_not_semantic");
  });

  it("accepts style and punctuation scopes and rejects malformed conventional subjects", async () => {
    const root = await mkdtemp(join(tmpdir(), "facility-runner-"));
    const path = join(root, "delivery.json");
    await writeFile(
      path,
      JSON.stringify({
        branch: "feature/format-auth-api",
        commitMessage:
          "style(web+api): normalize formatting\n\nBREAKING CHANGE: generated output changed",
        pullRequest: {
          title: "fix(api/auth)!: require scoped credentials",
          body: "## Summary\n- Normalize formatting and scope credentials.",
        },
      }),
    );

    await expect(readAgentDeliveryMetadata(path)).resolves.toMatchObject({
      commitMessage:
        "style(web+api): normalize formatting\n\nBREAKING CHANGE: generated output changed",
      pullRequest: { title: "fix(api/auth)!: require scoped credentials" },
    });

    await writeFile(
      path,
      JSON.stringify({
        branch: "feature/format-auth-api",
        commitMessage: "feature(web+api): normalize formatting",
        pullRequest: {
          title: "fix(api/auth): require scoped credentials",
          body: "Summary",
        },
      }),
    );
    await expect(readAgentDeliveryMetadata(path)).rejects.toThrow("commit_not_conventional");

    await writeFile(
      path,
      JSON.stringify({
        branch: "feature/format-auth-api",
        commitMessage: "style(web+api): normalize formatting",
        pullRequest: {
          title: "fix(api(auth)): require scoped credentials",
          body: "Summary",
        },
      }),
    );
    await expect(readAgentDeliveryMetadata(path)).rejects.toThrow("pr_title_not_conventional");
  });

  it("publishes agent-owned metadata through GitHub's signed commit mutation", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      requests.push({ url, init });
      if (init?.method === "POST" && url.endsWith("/git/refs")) {
        return new Response(JSON.stringify({ ref: "refs/heads/feature/task" }), { status: 201 });
      }
      if (url.endsWith("/graphql")) {
        return new Response(
          JSON.stringify({ data: { createCommitOnBranch: { commit: { oid: "signed_sha" } } } }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });
    };

    await expect(
      publishVerifiedGithubChanges({
        repo: "acme/widget",
        token: "installation-token",
        requestedBranch: "feature/task",
        baseSha: "base_sha",
        headline: "feat: deliver task",
        changes: [{ kind: "addition", path: "src/task.js", contents: "Y29udGVudA==" }],
        runId: "run_12345678",
        fetchImpl,
      }),
    ).resolves.toEqual({ branch: "feature/task", headSha: "signed_sha" });
    const mutation = JSON.parse(String(requests[2]?.init?.body));
    expect(mutation.variables.input.message.headline).toBe("feat: deliver task");
    expect(mutation.variables.input.fileChanges.additions[0]).toEqual({
      path: "src/task.js",
      contents: "Y29udGVudA==",
    });
    expect(requests[1]?.init?.headers).toMatchObject({
      authorization: "Bearer installation-token",
    });
  });

  it("updates the existing PR branch without creating a generic branch", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push({ url: String(input), init });
      return new Response(
        JSON.stringify({ data: { createCommitOnBranch: { commit: { oid: "updated_sha" } } } }),
        { status: 200 },
      );
    };
    await expect(
      publishVerifiedGithubBranchUpdate({
        repo: "acme/widget",
        token: "installation-token",
        branch: "automation/dependency-refresh",
        expectedHeadSha: "current_sha",
        headline: "fix: address review",
        changes: [{ kind: "addition", path: "src/task.js", contents: "Y29udGVudA==" }],
        runId: "run_12345678",
        fetchImpl,
      }),
    ).resolves.toEqual({ branch: "automation/dependency-refresh", headSha: "updated_sha" });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("https://api.github.com/graphql");
    const mutation = JSON.parse(String(requests[0]?.init?.body));
    expect(mutation.variables.input.branch.branchName).toBe("automation/dependency-refresh");
    expect(mutation.variables.input.expectedHeadOid).toBe("current_sha");
  });

  it("parses null-delimited git changes and preserves semantic branches", () => {
    expect(parseGitNameStatus("M\0src/math.js\0D\0old.js\0")).toEqual([
      { status: "M", path: "src/math.js" },
      { status: "D", path: "old.js" },
    ]);
    expect(semanticDeliveryBranch("feature/2-subtract", "main")).toBe("feature/2-subtract");
    expect(() => semanticDeliveryBranch("main", "main")).toThrow("branch_not_semantic");
  });

  it("accepts minimal agent-owned metadata for an existing PR update", async () => {
    const root = await mkdtemp(join(tmpdir(), "facility-runner-"));
    const path = join(root, "delivery.json");
    await writeFile(
      path,
      JSON.stringify({
        branch: "automation/dependency-refresh",
        commitMessage: "fix: address review\n\nKeep the explanation in the commit body.",
      }),
    );
    await expect(readAgentUpdateMetadata(path)).resolves.toEqual({
      branch: "automation/dependency-refresh",
      commitMessage: "fix: address review\n\nKeep the explanation in the commit body.",
    });
    await writeFile(
      path,
      JSON.stringify({ branch: "bad..branch", commitMessage: "fix: address review" }),
    );
    await expect(readAgentUpdateMetadata(path)).rejects.toThrow("branch_invalid");
  });

  it("reads bounded task-specific progress and requires it for governed agents", async () => {
    const root = await mkdtemp(join(tmpdir(), "facility-runner-"));
    const path = join(root, ".agent-sdlc", "progress.md");
    await mkdir(join(root, ".agent-sdlc"), { recursive: true });
    await writeFile(path, "Context\n\n- [x] Inspect\n- [ ] Verify\n");

    await expect(readAgentProgress(path)).resolves.toContain("- [ ] Verify");
    expect(requiresAgentProgress("codex-builder")).toBe(true);
    expect(requiresAgentProgress("ci-doctor")).toBe(true);
    expect(requiresAgentProgress("custom")).toBe(false);
  });

  it("installs registry skills as discoverable SKILL.md packages for both engines", async () => {
    const root = await mkdtemp(join(tmpdir(), "facility-runner-"));
    await prepareWorkspace(
      bundle({ skills: [{ name: "working to standard", content: "# Working to standard" }] }),
      "virtual-key",
      {
        platformKey: null,
        platformApiUrl: "https://api.test",
        projectId: "proj_test",
        repoToken: null,
      },
      root,
    );

    for (const engineRoot of [".claude", ".agents"]) {
      await expect(
        readFile(
          join(root, "scratch", engineRoot, "skills", "working_to_standard", "SKILL.md"),
          "utf8",
        ),
      ).resolves.toContain(
        '---\nname: "working_to_standard"\ndescription: "Project-managed Facility skill: working to standard"\n---\n\n# Working to standard',
      );
    }
  });

  it("keeps platform-managed skills and harness context out of a cloned repository diff", async () => {
    const root = await mkdtemp(join(tmpdir(), "facility-runner-"));
    const origin = join(root, "origin");
    await mkdir(origin);
    execFileSync("git", ["init", "--initial-branch=main"], { cwd: origin });
    execFileSync("git", ["config", "user.email", "facility@example.invalid"], { cwd: origin });
    execFileSync("git", ["config", "user.name", "Facility Test"], { cwd: origin });
    await writeFile(join(origin, "README.md"), "# Fixture\n");
    execFileSync("git", ["add", "README.md"], { cwd: origin });
    execFileSync("git", ["commit", "-m", "test: initialize fixture"], { cwd: origin });

    await prepareWorkspace(
      bundle({
        repo: { cloneUrl: origin, branch: "main", installationTokenRef: null },
        skills: [{ name: "validation evidence", content: "# Validation evidence" }],
        harness: {
          files: {
            "harness/SESSION.md": "# Session",
            "harness/ACTIVE.md": "## Objective",
          },
        },
      }),
      "virtual-key",
      {
        platformKey: null,
        platformApiUrl: "https://api.test",
        projectId: "proj_test",
        repoToken: null,
      },
      root,
    );

    const cloned = join(root, "repo");
    expect(execFileSync("git", ["status", "--short"], { cwd: cloned, encoding: "utf8" })).toBe("");
    await expect(readFile(join(cloned, ".git", "info", "exclude"), "utf8")).resolves.toContain(
      ".agents/skills/validation_evidence/",
    );
    await expect(readFile(join(cloned, ".git", "info", "exclude"), "utf8")).resolves.toContain(
      "harness/SESSION.md",
    );
    await expect(readFile(join(cloned, ".git", "info", "exclude"), "utf8")).resolves.toContain(
      ".agent-sdlc/progress.md",
    );
    await expect(readFile(join(cloned, "harness", "ACTIVE.md"), "utf8")).resolves.toBe(
      "## Objective",
    );
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

describe("Claude resume controls", () => {
  it("uses --resume only after session state has been restored", () => {
    const runBundle = bundle({
      engine: "claude_code",
      resume: {
        sessionId: "sess_123",
        sessionStateFrom: "run_parent",
        prompt: "continue",
      },
    });
    expect(buildClaudeCodeArgs(runBundle, true).slice(0, 4)).toEqual([
      "-p",
      "continue",
      "--resume",
      "sess_123",
    ]);
    expect(buildClaudeCodeArgs(runBundle, false)).not.toContain("--resume");
    expect(buildClaudeCodeArgs(runBundle, false)).toContain(composedPrompt(runBundle));
  });

  it("branches steer and interrupt control messages", async () => {
    const events: unknown[] = [];
    const steers: string[] = [];
    let interrupted = false;
    await expect(
      handleControlMessage(
        { id: "msg_1", kind: "steer", body: "please adjust" },
        {
          appendSteer: async (body) => {
            steers.push(body);
          },
          emit: async (batch) => {
            events.push(...batch);
          },
          interrupt: async () => {
            interrupted = true;
          },
        },
      ),
    ).resolves.toBe("steer");
    expect(steers).toEqual(["please adjust"]);
    expect(interrupted).toBe(false);

    await expect(
      handleControlMessage(
        { id: "msg_2", kind: "interrupt", body: "stop" },
        {
          appendSteer: async (body) => {
            steers.push(body);
          },
          emit: async (batch) => {
            events.push(...batch);
          },
          interrupt: async () => {
            interrupted = true;
          },
        },
      ),
    ).resolves.toBe("interrupt");
    expect(interrupted).toBe(true);
    expect(events).toEqual(
      expect.arrayContaining([
        { type: "status", data: { message: "human interrupt" } },
        { type: "steer", data: { id: "msg_2", kind: "interrupt" } },
      ]),
    );
  });

  it("signals SIGTERM before SIGKILL on interrupt termination", () => {
    const signals: string[] = [];
    const timers: Array<() => void> = [];
    const clear = terminateChild(
      {
        kill: (signal) => {
          signals.push(String(signal));
          return true;
        },
      },
      15_000,
      ((callback: () => void) => {
        timers.push(callback);
        return 1 as unknown as ReturnType<typeof setTimeout>;
      }) as typeof setTimeout,
    );
    expect(signals).toEqual(["SIGTERM"]);
    timers[0]?.();
    expect(signals).toEqual(["SIGTERM", "SIGKILL"]);
    clear();
  });
});

describe("Codex model controls", () => {
  it("applies the configured model and reasoning effort", () => {
    const args = buildCodexArgs(
      bundle({
        engineConfig: { primary: "gpt-5.6", reasoning_effort: "high" },
      }),
    );
    expect(args).toContain("--model");
    expect(args).toContain("gpt-5.6");
    expect(args).toContain('model_reasoning_effort="high"');
    expect(args).toContain('model_provider="facility_gateway"');
    expect(args).toContain('model_providers.facility_gateway.base_url="https://openai.test/v1"');
    expect(args).toContain('model_providers.facility_gateway.env_key="OPENAI_API_KEY"');
    expect(args).toContain("model_providers.facility_gateway.supports_websockets=false");
    expect(args.at(-1)).toBe("-");
    expect(args.some((value) => value.includes("Do the work."))).toBe(false);
  });

  it("does not duplicate an existing gateway API version", () => {
    const args = buildCodexArgs(
      bundle({
        gatewayUrls: { anthropic: "https://anthropic.test", openai: "https://openai.test/v1" },
      }),
    );
    expect(args).toContain('model_providers.facility_gateway.base_url="https://openai.test/v1"');
    expect(args.join(" ")).not.toContain("/v1/v1");
  });

  it("keeps large learning packets out of argv", () => {
    const args = buildCodexArgs(
      bundle({ mode: "learning", scope: { packet: "x".repeat(512_000) } }),
    );
    expect(args.at(-1)).toBe("-");
    expect(Math.max(...args.map((value) => value.length))).toBeLessThan(2_000);
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
