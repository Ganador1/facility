import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  ALLOWED_TYPES,
  assertRange,
  assertSubject,
  parseSubject,
  subjectsInRange,
} from "./conventional-commit-subjects.mjs";

const subjectScript = fileURLToPath(
  new URL("./conventional-commit-subjects.mjs", import.meta.url),
);
const repoRoot = dirname(dirname(subjectScript));

function subjectCli(command, environment) {
  return spawnSync(process.execPath, [subjectScript, command], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, ...environment },
  });
}

function git(repoDir, args) {
  return execFileSync(
    "git",
    [
      "-c",
      "commit.gpgSign=false",
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "user.name=Facility Tests",
      "-c",
      "user.email=facility-tests@example.invalid",
      ...args,
    ],
    {
      cwd: repoDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
      },
    },
  ).trim();
}

function localRepository(t, name) {
  const repoDir = mkdtempSync(join(tmpdir(), `facility-subjects-${name}-`));
  t.after(() => rmSync(repoDir, { recursive: true, force: true }));
  git(repoDir, ["init", "--initial-branch=main"]);
  writeFileSync(join(repoDir, "change.txt"), "base\n");
  git(repoDir, ["add", "change.txt"]);
  git(repoDir, ["commit", "-m", "chore: establish the fixture"]);
  return repoDir;
}

function commitChange(repoDir, content, subject) {
  writeFileSync(join(repoDir, "change.txt"), `${content}\n`);
  git(repoDir, ["add", "change.txt"]);
  git(repoDir, ["commit", "-m", subject]);
}

test("the repository's allowed Conventional Commit types are accepted", () => {
  const expected = [
    "feat",
    "fix",
    "docs",
    "style",
    "refactor",
    "perf",
    "test",
    "build",
    "ci",
    "chore",
    "revert",
  ];

  assert.deepEqual(ALLOWED_TYPES, expected);
  for (const type of expected) {
    assert.deepEqual(parseSubject(`${type}: describe the change`), {
      type,
      scope: null,
      breaking: false,
      summary: "describe the change",
    });
  }
});

test("breaking markers and established punctuation in scopes are accepted", () => {
  assert.deepEqual(parseSubject("feat(web+api)!: replace the public contract"), {
    type: "feat",
    scope: "web+api",
    breaking: true,
    summary: "replace the public contract",
  });

  for (const scope of ["web+api", "api/auth", "registry,sandbox"]) {
    assert.deepEqual(assertSubject(`fix(${scope}): keep the existing scope`), {
      type: "fix",
      scope,
      breaking: false,
      summary: "keep the existing scope",
    });
  }
  assert.equal(assertSubject("perf!: remove the legacy path").breaking, true);
});

test("unknown types and malformed subjects are rejected", () => {
  for (const subject of [
    "unknown: describe the change",
    "fix(): describe the change",
    "fix(api(auth)): describe the change",
    "fix(api):",
    "fix(api):   ",
  ]) {
    assert.throws(() => assertSubject(subject), undefined, subject);
  }
});

test("commit ranges are read as non-merge subjects from base-exclusive history", () => {
  const calls = [];
  const subjects = subjectsInRange("base-sha", "head-sha", {
    repoDir: "/fixture/repository",
    exec(command, args, options) {
      calls.push({ command, args, options });
      return "feat: add the capability\0fix(api/auth)!: close the gap\0";
    },
  });

  assert.deepEqual(subjects, ["feat: add the capability", "fix(api/auth)!: close the gap"]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "git");
  assert.deepEqual(calls[0].args, [
    "log",
    "-z",
    "--no-merges",
    "--format=%s",
    "base-sha..head-sha",
  ]);
  assert.equal(calls[0].options.cwd, "/fixture/repository");
  assert.equal(calls[0].options.encoding, "utf8");
});

test("commit ranges follow the subjects that survive squash, no-ff, and rebase merges", (t) => {
  const squashRepo = localRepository(t, "squash");
  const squashBase = git(squashRepo, ["rev-parse", "HEAD"]);
  git(squashRepo, ["checkout", "-b", "squash-feature"]);
  commitChange(squashRepo, "squash step one", "fix(web+api): prepare the squash");
  commitChange(squashRepo, "squash step two", "feat(api/auth): finish the squash");
  git(squashRepo, ["checkout", "main"]);
  git(squashRepo, ["merge", "--squash", "squash-feature"]);
  git(squashRepo, ["commit", "-m", "feat(registry,sandbox)!: land one squash subject"]);
  const squashHead = git(squashRepo, ["rev-parse", "HEAD"]);

  assert.deepEqual(subjectsInRange(squashBase, squashHead, { repoDir: squashRepo }), [
    "feat(registry,sandbox)!: land one squash subject",
  ]);

  const mergeRepo = localRepository(t, "merge");
  const mergeBase = git(mergeRepo, ["rev-parse", "HEAD"]);
  git(mergeRepo, ["checkout", "-b", "merge-feature"]);
  commitChange(mergeRepo, "merge step one", "feat(api/auth): add the first commit");
  commitChange(mergeRepo, "merge step two", "fix(registry,sandbox): add the second commit");
  git(mergeRepo, ["checkout", "main"]);
  git(mergeRepo, ["merge", "--no-ff", "merge-feature", "-m", "Merge branch 'merge-feature'"]);
  const mergeHead = git(mergeRepo, ["rev-parse", "HEAD"]);

  assert.deepEqual(subjectsInRange(mergeBase, mergeHead, { repoDir: mergeRepo }), [
    "fix(registry,sandbox): add the second commit",
    "feat(api/auth): add the first commit",
  ]);

  const rebaseRepo = localRepository(t, "rebase");
  git(rebaseRepo, ["checkout", "-b", "rebase-feature"]);
  commitChange(rebaseRepo, "rebase step one", "feat(api/auth): add the rebased feature");
  commitChange(rebaseRepo, "rebase step two", "fix(web+api): finish the rebased feature");
  git(rebaseRepo, ["checkout", "main"]);
  writeFileSync(join(rebaseRepo, "main.txt"), "advance main\n");
  git(rebaseRepo, ["add", "main.txt"]);
  git(rebaseRepo, ["commit", "-m", "chore: advance the target branch"]);
  const rebaseBase = git(rebaseRepo, ["rev-parse", "HEAD"]);
  git(rebaseRepo, ["checkout", "rebase-feature"]);
  git(rebaseRepo, ["rebase", "main"]);
  git(rebaseRepo, ["checkout", "main"]);
  git(rebaseRepo, ["merge", "--ff-only", "rebase-feature"]);
  const rebaseHead = git(rebaseRepo, ["rev-parse", "HEAD"]);

  assert.deepEqual(subjectsInRange(rebaseBase, rebaseHead, { repoDir: rebaseRepo }), [
    "fix(web+api): finish the rebased feature",
    "feat(api/auth): add the rebased feature",
  ]);
});

test("an empty commit subject is retained and rejected", (t) => {
  const repoDir = localRepository(t, "empty-subject");
  const baseSha = git(repoDir, ["rev-parse", "HEAD"]);
  git(repoDir, ["commit", "--allow-empty", "--allow-empty-message", "-m", ""]);
  const headSha = git(repoDir, ["rev-parse", "HEAD"]);

  assert.deepEqual(subjectsInRange(baseSha, headSha, { repoDir }), [""]);
  assert.throws(
    () => assertRange(baseSha, headSha, { repoDir }),
    /commit subject is not allowed:[\s\S]*""/,
  );
});

test("the title CLI accepts valid input and denies invalid input", () => {
  const accepted = subjectCli("title", {
    TITLE: "feat(web+api)!: replace the public contract",
  });
  assert.equal(accepted.status, 0, accepted.stderr);

  const denied = subjectCli("title", { TITLE: "unknown: hide a release change" });
  assert.notEqual(denied.status, 0, denied.stdout);
  assert.match(denied.stderr, /unknown: hide a release change/);
});

test("workflows validate edited titles, pull request commits, and landed main commits", () => {
  const titleWorkflow = readFileSync(
    new URL("../.github/workflows/pull-request-title.yml", import.meta.url),
    "utf8",
  );
  const ciWorkflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");

  const titleTriggers = titleWorkflow.split(/^jobs:/m)[0];
  assert.match(titleTriggers, /pull_request:\s*\n\s+types:/);
  for (const activity of ["opened", "synchronize", "reopened", "edited"]) {
    assert.match(titleTriggers, new RegExp(`\\b${activity}\\b`));
  }
  assert.match(titleWorkflow, /node scripts\/conventional-commit-subjects\.mjs title\b/);

  const rangeJobs = ciWorkflow
    .split(/(?=^  [a-zA-Z0-9_-]+:\s*$)/m)
    .filter((job) => /node scripts\/conventional-commit-subjects\.mjs range\b/.test(job));
  assert(rangeJobs.length > 0, "ci.yml must invoke the commit-range validator");
  assert(
    rangeJobs.some((job) => /github\.event_name == 'pull_request'/.test(job)),
    "ci.yml must validate pull request commits",
  );
  assert(
    rangeJobs.some((job) => /github\.ref == 'refs\/heads\/main'/.test(job)),
    "ci.yml must revalidate commits landed on main",
  );
});
