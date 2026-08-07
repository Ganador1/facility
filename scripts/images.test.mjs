import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  BUILD_IMAGES,
  loadDigests,
  parseTagsJson,
  publicationPlan,
  recordDigest,
  validateRepositoryIdentity,
} from "./images.mjs";

const sha = "a".repeat(40);
const digest = `sha256:${"b".repeat(64)}`;
const imagesWorkflow = readFileSync(
  new URL("../.github/workflows/images.yml", import.meta.url),
  "utf8",
);
const ciWorkflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");

test("manual publication is SHA-only even when dispatch targets a tag", () => {
  for (const ref of ["refs/heads/main", "refs/heads/feature", "refs/tags/v0.3.0"]) {
    assert.deepEqual(
      publicationPlan({
        eventName: "workflow_dispatch",
        ref,
        visibility: "public",
        sha,
      }),
      { mode: "manual", tags: [`sha-${sha.slice(0, 12)}`] },
    );
  }
});

test("an accepted release publishes its immutable SHA and matching version tags", () => {
  assert.deepEqual(
    publicationPlan({
      eventName: "push",
      ref: "refs/heads/main",
      visibility: "public",
      sha,
      release: { tag: "v0.3.0", version: "0.3.0" },
    }),
    { mode: "release", tags: [`sha-${sha.slice(0, 12)}`, "0.3.0"] },
  );
});

test("malformed, private, and unvalidated release inputs fail closed", () => {
  const valid = {
    eventName: "push",
    ref: "refs/heads/main",
    visibility: "public",
    sha,
    release: { tag: "v0.3.0", version: "0.3.0" },
  };
  const invalid = [
    [{ sha: "deadbeef" }, /full lowercase GitHub commit SHA/],
    [{ eventName: "pull_request" }, /does not accept pull_request/],
    [{ visibility: "private" }, /disabled until the repository is public/],
    [{ release: undefined }, /requires a validated release/],
    [{ release: { tag: "vlatest", version: "0.3.0" } }, /does not match v0\.3\.0/],
    [{ ref: "refs/tags/v0.3.0" }, /release images come from main/],
    [{ ref: "refs/heads/feature" }, /release images come from main/],
    [{ release: { tag: "v0.3.0,latest", version: "0.3.0,latest" } }, /invalid container tag/],
  ];
  for (const [override, message] of invalid) {
    assert.throws(() => publicationPlan({ ...valid, ...override }), message);
  }
});

test("repository and tag inputs reject cross-owner and injection-shaped values", () => {
  assert.deepEqual(
    validateRepositoryIdentity({
      repository: "theam/facility",
      owner: "theam",
      ownerType: "Organization",
    }),
    {
      owner: "theam",
      ownerType: "Organization",
      repository: "theam/facility",
      repositoryName: "facility",
    },
  );
  assert.throws(
    () =>
      validateRepositoryIdentity({
        repository: "another/facility",
        owner: "theam",
        ownerType: "Organization",
      }),
    /does not belong to expected owner/,
  );
  assert.throws(() => parseTagsJson('["sha-good","bad,tag"]'), /invalid container tag/);
  assert.throws(() => parseTagsJson('["same","same"]'), /duplicate tag/);
});

test("digest manifests require the complete, expected five-image set", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "facility-image-digests-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  for (const image of BUILD_IMAGES) recordDigest({ image, digest, directory });
  assert.deepEqual(
    [...loadDigests(directory)],
    BUILD_IMAGES.map((image) => [image, digest]),
  );

  writeFileSync(join(directory, "api.json"), JSON.stringify({ image: "worker", digest }));
  assert.throws(() => loadDigests(directory), /names worker, expected api/);
});

test("CI gates release images and the reusable publisher stages digests before promotion", () => {
  assert.match(imagesWorkflow, /on:\n {2}workflow_call:\n {4}inputs:\n {6}version:/);
  assert.match(imagesWorkflow, /\n {2}workflow_dispatch:\n/);
  assert.doesNotMatch(imagesWorkflow, /tags: \["v\*"\]/);
  assert.match(
    imagesWorkflow,
    /group: images-\$\{\{ github\.repository \}\}\n {2}cancel-in-progress: false/,
  );
  assert.match(imagesWorkflow, /node scripts\/images\.mjs plan/);
  const buildJob = imagesWorkflow.split("\n  promote:")[0].split("\n  build:")[1];
  assert.ok(buildJob, "images workflow must contain a build job");
  assert.match(
    buildJob,
    /- name: Stamp the decided version\n {8}if: inputs\.version != ''\n {8}run: node scripts\/release\.mjs stamp "\$\{\{ inputs\.version \}\}"/,
  );
  assert.ok(
    buildJob.indexOf("Stamp the decided version") <
      buildJob.indexOf("Build and push the addressable digest"),
    "the isolated build checkout must be stamped before Docker consumes it",
  );
  assert.match(imagesWorkflow, /push-by-digest=true,name-canonical=true,push=true/);
  assert.doesNotMatch(
    buildJob,
    /build[_-]args|FACILITY_API_URL=/,
    "the release web image must remain portable across runtime API origins",
  );
  assert.match(imagesWorkflow, /promote:\n {4}needs: \[plan, build\]/);
  assert.match(imagesWorkflow, /node scripts\/images\.mjs promote/);
  assert.match(
    ciWorkflow,
    /publish-images:[\s\S]*needs: \[decide-release, verify, package-release, self-host-build, sandbox-e2e\]/,
  );
  assert.match(ciWorkflow, /publish-images:[\s\S]*uses: \.\/\.github\/workflows\/images\.yml/);
});
