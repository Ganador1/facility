import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createGithubClientFactory, type FacilityGithubClient } from "../src/github/client.js";
import { readRepoFiles } from "../src/github/repo-files.js";

describe("GitHub client factory", () => {
  it("creates installation clients with the REST helpers used by production flows", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const factory = createGithubClientFactory({
      githubAppId: "1",
      githubAppPrivateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    } as Parameters<typeof createGithubClientFactory>[0]);

    const client = await factory(123);

    expect(client.request).toBeTypeOf("function");
    expect(client.rest.repos.get).toBeTypeOf("function");
    expect(client.rest.repos.createInOrg).toBeTypeOf("function");
    expect(client.rest.git.createCommit).toBeTypeOf("function");
    expect(client.rest.pulls.create).toBeTypeOf("function");
    expect(client.rest.issues.createComment).toBeTypeOf("function");
  });
});

describe("GitHub repository file reader", () => {
  it("includes symlink targets in managed-file fingerprints", async () => {
    const client = {
      getContent: async () => ({
        type: "symlink",
        path: ".agents/skills",
        target: "../.claude/skills",
      }),
    } as unknown as FacilityGithubClient;

    await expect(readRepoFiles(client, "main", [".agents/skills"])).resolves.toEqual(
      new Map([[".agents/skills", "../.claude/skills"]]),
    );
  });
});
