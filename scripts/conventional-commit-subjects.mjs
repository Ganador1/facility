#!/usr/bin/env node
// The subjects that land on main decide the released version. Keep the policy
// here so PR-title checks, PR commit checks, and landed-history checks cannot
// drift into accepting different commit grammars.
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const ALLOWED_TYPES = Object.freeze([
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
]);

const SUBJECT = new RegExp(
  `^(?<type>${ALLOWED_TYPES.join("|")})(?:\\((?<scope>[^()]+)\\))?(?<breaking>!)?: (?<summary>\\S.*)$`,
);

export function parseSubject(subject) {
  if (typeof subject !== "string") return null;
  const match = SUBJECT.exec(subject.trim());
  if (!match?.groups) return null;
  return {
    type: match.groups.type,
    scope: match.groups.scope ?? null,
    breaking: match.groups.breaking === "!",
    summary: match.groups.summary,
  };
}

export function assertSubject(subject, { label = "subject" } = {}) {
  const parsed = parseSubject(subject);
  if (parsed) return parsed;
  throw new Error(
    `${label} is not an allowed Conventional Commit: ${JSON.stringify(subject)}\n` +
      "Expected: <type>[(scope)][!]: <what changed>\n" +
      `Allowed types: ${ALLOWED_TYPES.join(" ")}`,
  );
}

export function subjectsInRange(
  baseSha,
  headSha,
  { repoDir = process.cwd(), exec = execFileSync } = {},
) {
  if (!baseSha || !headSha) throw new Error("both BASE_SHA and HEAD_SHA are required");
  return exec(
    "git",
    ["log", "--no-merges", "--format=%s", `${baseSha}..${headSha}`],
    { cwd: repoDir, encoding: "utf8" },
  )
    .split("\n")
    .map((subject) => subject.trim())
    .filter(Boolean);
}

export function assertRange(baseSha, headSha, options) {
  const subjects = subjectsInRange(baseSha, headSha, options);
  const invalid = subjects.filter((subject) => !parseSubject(subject));
  if (invalid.length > 0) {
    throw new Error(
      [
        `${invalid.length} commit subject${invalid.length === 1 ? " is" : "s are"} not allowed:`,
        ...invalid.map((subject) => `  ${subject}`),
        "Expected: <type>[(scope)][!]: <what changed>",
        `Allowed types: ${ALLOWED_TYPES.join(" ")}`,
      ].join("\n"),
    );
  }
  return subjects;
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function main() {
  const command = process.argv[2];
  if (command === "title") {
    const title = required("TITLE");
    assertSubject(title, { label: "pull request title" });
    console.log(`OK: ${title}`);
    return;
  }
  if (command === "range") {
    const subjects = assertRange(required("BASE_SHA"), required("HEAD_SHA"));
    console.log(`OK: ${subjects.length} non-merge commit subject${subjects.length === 1 ? "" : "s"}`);
    return;
  }
  throw new Error("Usage: conventional-commit-subjects.mjs title|range");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
