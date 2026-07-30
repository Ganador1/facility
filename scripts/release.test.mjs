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
  ref: "refs/heads/main",
  visibility: "public",
  rootVersion: "0.3.0",
  packageVersion: "0.3.0",
  decidedVersion: "0.3.0",
  headSha: "release-sha",
  checkoutSha: "release-sha",
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

test("only an accepted public main push with a decision enters publish mode", () => {
  const accepted = {
    eventName: "push",
    ref: "refs/heads/main",
    visibility: "public",
    acceptancePassed: true,
    releaseDecided: true,
  };
  assert.equal(releaseMode(accepted), "publish");

  for (const candidate of [
    { ...accepted, releaseDecided: false },
    { ...accepted, releaseDecided: "true" },
    { ...accepted, ref: "refs/heads/feature" },
    { ...accepted, ref: "refs/tags/v0.3.0" },
    { ...accepted, eventName: "pull_request" },
    { ...accepted, visibility: "private" },
    { ...accepted, acceptancePassed: false },
    { ...accepted, acceptancePassed: "false" },
    { ...accepted, acceptancePassed: "failure" },
  ]) {
    assert.equal(releaseMode(candidate), "skip");
  }
});

test("release policy accepts only a stamped main commit matching the decision", () => {
  assert.deepEqual(validateReleasePolicy(validPolicy), {
    packageName: "@theagilemonkeys/facility",
    version: "0.3.0",
    tag: "v0.3.0",
  });
});

test("release policy fails closed on every version and provenance mismatch", () => {
  const invalid = [
    [{ eventName: "workflow_dispatch" }, /real release must come from a push event/],
    [{ visibility: "private" }, /publishing is disabled until the repository is public/],
    [{ ref: "refs/tags/v0.3.0" }, /a release must come from main, not refs\/tags\/v0\.3\.0/],
    [{ decidedVersion: undefined }, /no release version was decided for this commit/],
    [{ rootVersion: "0.2.0" }, /root package version \(0\.2\.0\) does not match CLI package version \(0\.3\.0\)/],
    [
      { decidedVersion: "0.4.0" },
      /stamped version 0\.3\.0 does not match the decided version 0\.4\.0/,
    ],
    [{ checkoutSha: "other-sha" }, /checked-out commit other-sha does not match event SHA release-sha/],
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

test("the workflow keeps manual runs credential-free and real publication main-only", () => {
  assert.match(releaseWorkflow, /workflow_call:\n    inputs:\n      version:/);
  assert.doesNotMatch(releaseWorkflow, /workflow_dispatch:\n\s+inputs:/);
  assert.match(releaseWorkflow, /dry-run:\n    if: github\.event_name == 'workflow_dispatch'/);
  assert.match(
    releaseWorkflow,
    /publish:\n    if: github\.event_name == 'push' && github\.ref == 'refs\/heads\/main' && github\.event\.repository\.visibility == 'public'/,
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
  assert.match(
    ciWorkflow,
    /publish-npm:[\s\S]*needs: \[decide-release, verify, package-release, self-host-build, sandbox-e2e\]/,
  );
  assert.match(ciWorkflow, /publish-npm:[\s\S]*uses: \.\/\.github\/workflows\/release\.yml/);
});
