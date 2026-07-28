import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  OFFICIAL_REGISTRY,
  normalizeRegistry,
  releaseMode,
  validateReleasePolicy,
} from "./release.mjs";

const releaseWorkflow = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
const ciWorkflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");

const validPolicy = {
  eventName: "push",
  ref: "refs/tags/v0.3.0",
  visibility: "public",
  rootVersion: "0.3.0",
  packageVersion: "0.3.0",
  headSha: "release-sha",
  checkoutSha: "release-sha",
  tagSha: "release-sha",
  isOnMain: true,
};

test("manual dispatches are dry-runs even when a real publish is requested", () => {
  assert.equal(
    releaseMode({
      eventName: "workflow_dispatch",
      ref: "refs/heads/release-candidate",
      visibility: "public",
      acceptancePassed: true,
      requestedDryRun: false,
    }),
    "dry-run",
  );
});

test("only an accepted public tag push enters publish mode", () => {
  assert.equal(
    releaseMode({
      eventName: "push",
      ref: "refs/tags/v0.3.0",
      visibility: "public",
      acceptancePassed: true,
    }),
    "publish",
  );

  for (const candidate of [
    { eventName: "push", ref: "refs/heads/main", visibility: "public", acceptancePassed: true },
    { eventName: "pull_request", ref: "refs/tags/v0.3.0", visibility: "public", acceptancePassed: true },
    { eventName: "push", ref: "refs/tags/v0.3.0", visibility: "private", acceptancePassed: true },
    { eventName: "push", ref: "refs/tags/v0.3.0", visibility: "public", acceptancePassed: false },
    { eventName: "push", ref: "refs/tags/v0.3.0", visibility: "public", acceptancePassed: "false" },
    { eventName: "push", ref: "refs/tags/v0.3.0", visibility: "public", acceptancePassed: "failure" },
  ]) {
    assert.equal(releaseMode(candidate), "skip");
  }
});

test("release policy accepts only the matching package tag and commit", () => {
  assert.deepEqual(validateReleasePolicy(validPolicy), {
    packageName: "@theagilemonkeys/facility",
    version: "0.3.0",
    tag: "v0.3.0",
  });
});

test("release policy fails closed on every tag and provenance mismatch", () => {
  const invalid = [
    [{ eventName: "workflow_dispatch" }, /real release must come from a push event/],
    [{ visibility: "private" }, /publishing is disabled until the repository is public/],
    [{ rootVersion: "0.2.0" }, /root package version \(0\.2\.0\) does not match CLI package version \(0\.3\.0\)/],
    [{ ref: "refs/tags/v0.3.1" }, /release ref refs\/tags\/v0\.3\.1 does not match refs\/tags\/v0\.3\.0/],
    [{ checkoutSha: "other-sha" }, /checked-out commit other-sha does not match event SHA release-sha/],
    [{ tagSha: "other-sha" }, /release tag resolves to other-sha, not event SHA release-sha/],
    [{ isOnMain: false }, /release commit is not reachable from origin\/main/],
  ];

  for (const [override, message] of invalid) {
    assert.throws(() => validateReleasePolicy({ ...validPolicy, ...override }), message);
  }
});

test("GitHub publication requires the exact official npm registry", () => {
  assert.equal(normalizeRegistry(OFFICIAL_REGISTRY, { githubActions: true }).href, OFFICIAL_REGISTRY);
  assert.throws(
    () => normalizeRegistry("https://registry.npmjs.org/custom", { githubActions: true }),
    /must use exactly https:\/\/registry\.npmjs\.org\//,
  );
  assert.throws(
    () => normalizeRegistry("http://127.0.0.1:4873", { githubActions: true }),
    /must use exactly https:\/\/registry\.npmjs\.org\//,
  );
});

test("the workflow keeps manual runs credential-free and real publication tag-only", () => {
  assert.match(releaseWorkflow, /workflow_call:\n  workflow_dispatch:\n/);
  assert.doesNotMatch(releaseWorkflow, /workflow_dispatch:\n\s+inputs:/);
  assert.match(releaseWorkflow, /dry-run:\n    if: github\.event_name == 'workflow_dispatch'/);
  assert.match(
    releaseWorkflow,
    /publish:\n    if: github\.event_name == 'push' && startsWith\(github\.ref, 'refs\/tags\/'\) && github\.event\.repository\.visibility == 'public'/,
  );
  assert.match(releaseWorkflow, /node scripts\/release\.mjs dry-run "\$candidate"/);
  assert.match(releaseWorkflow, /node scripts\/release\.mjs publish "\$CANDIDATE" --auth=oidc/);
  assert.match(releaseWorkflow, /node scripts\/release\.mjs publish "\$CANDIDATE" --auth=bootstrap/);

  const dryRunJob = releaseWorkflow.split("\n  publish:")[0].split("\n  dry-run:")[1];
  assert.doesNotMatch(dryRunJob, /id-token: write|environment:|secrets\./);
  assert.equal(releaseWorkflow.match(/secrets\.NPM_BOOTSTRAP_TOKEN/g)?.length, 1);
  assert.match(releaseWorkflow, /environment: npm/);
  assert.match(releaseWorkflow, /npm install --global npm@11\.15\.0/);
  assert.match(
    releaseWorkflow,
    /publish:[\s\S]*concurrency:\n      group: npm-theagilemonkeys-facility\n      cancel-in-progress: false/,
  );
});

test("CI publishes only the exact artifact produced after all acceptance jobs", () => {
  assert.match(ciWorkflow, /npm pack --ignore-scripts --pack-destination "\$release_dir"/);
  assert.match(ciWorkflow, /name: facility-release-package/);
  assert.match(ciWorkflow, /publish-npm:[\s\S]*needs: \[verify, self-host-build, sandbox-e2e\]/);
  assert.match(ciWorkflow, /publish-npm:[\s\S]*uses: \.\/\.github\/workflows\/release\.yml/);
});
