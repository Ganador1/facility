import assert from "node:assert/strict";
import { test } from "node:test";
import { classify, decide, nextVersion, parseSubject, releaseNotes } from "./version.mjs";

test("parses conventional subjects, including scopes and breaking markers", () => {
  assert.deepEqual(parseSubject("feat: add the inbox"), {
    type: "feat",
    scope: null,
    breaking: false,
    summary: "add the inbox",
  });
  assert.deepEqual(parseSubject("fix(gateway): drain metering on shutdown"), {
    type: "fix",
    scope: "gateway",
    breaking: false,
    summary: "drain metering on shutdown",
  });
  assert.equal(parseSubject("chore(deps)!: drop node 20")?.breaking, true);
});

test("ignores subjects that are not conventional commits", () => {
  assert.equal(parseSubject("Update README"), null);
  assert.equal(parseSubject("Merge pull request #51 from theam/ci/publish-images"), null);
  assert.deepEqual(classify(["Update README", "wip"]), []);
});

test("only user-visible types release", () => {
  const commits = classify([
    "docs: retire the v1 PRD",
    "ci: publish the service images",
    "chore: tidy",
    "test: cover the drain",
    "fix(gateway): drain metering",
  ]);
  assert.deepEqual(
    commits.map((commit) => commit.type),
    ["fix"],
  );
});

test("a breaking change releases even when its type would not", () => {
  const commits = classify(["refactor!: rename the run contract"]);
  assert.equal(commits.length, 1);
  assert.equal(commits[0].breaking, true);
});

test("a BREAKING CHANGE footer counts as breaking", () => {
  const bodies = { "refactor: rename the run contract": "BREAKING CHANGE: runs/:id moved" };
  const commits = classify(["refactor: rename the run contract"], {
    body: (subject) => bodies[subject] ?? "",
  });
  assert.equal(commits.length, 1);
  assert.equal(commits[0].breaking, true);
});

test("before 1.0 a breaking change is a minor and everything else a patch", () => {
  assert.equal(nextVersion("0.3.0", classify(["fix: a"])), "0.3.1");
  assert.equal(nextVersion("0.3.0", classify(["feat: a"])), "0.3.1");
  assert.equal(nextVersion("0.3.7", classify(["feat!: a"])), "0.4.0");
});

test("after 1.0 the usual semver applies", () => {
  assert.equal(nextVersion("1.4.2", classify(["fix: a"])), "1.4.3");
  assert.equal(nextVersion("1.4.2", classify(["feat: a"])), "1.5.0");
  assert.equal(nextVersion("1.4.2", classify(["feat!: a"])), "2.0.0");
});

test("nothing releasing means no version at all", () => {
  assert.equal(nextVersion("0.3.0", classify(["docs: a", "chore: b"])), null);
});

test("release notes lead with breaking changes and name the scope", () => {
  const notes = releaseNotes(
    "0.4.0",
    classify(["feat!: require node 22", "fix(gateway): drain metering", "feat: add the inbox"]),
  );
  assert.match(notes, /^## 0\.4\.0/);
  assert.ok(notes.indexOf("Breaking changes") < notes.indexOf("Features"));
  assert.ok(notes.includes("- **gateway**: drain metering"));
});

test("decide reads the last v-tag and the subjects after it", () => {
  const calls = [];
  const exec = (_command, args) => {
    calls.push(args.join(" "));
    if (args[0] === "tag") return "v0.3.0\nv0.2.9\nnot-a-tag\n";
    if (args[0] === "log") return "fix: one\ndocs: two\n";
    throw new Error(`unexpected git call: ${args.join(" ")}`);
  };
  const decision = decide({ repoDir: "/tmp", exec });
  assert.equal(decision.previous, "0.3.0");
  assert.equal(decision.version, "0.3.1");
  assert.equal(decision.tag, "v0.3.1");
  assert.equal(decision.considered, 2);
  assert.equal(decision.releasing, 1);
  assert.ok(calls.some((call) => call.includes("v0.3.0..HEAD")));
});

test("decide starts from 0.0.0 when the repository has never released", () => {
  const exec = (_command, args) => {
    if (args[0] === "tag") return "\n";
    if (args[0] === "log") return "feat: first\n";
    throw new Error("unexpected");
  };
  assert.equal(decide({ repoDir: "/tmp", exec }).version, "0.0.1");
});

test("decide reports no release when only invisible work landed", () => {
  const exec = (_command, args) => {
    if (args[0] === "tag") return "v0.3.0\n";
    if (args[0] === "log") return "docs: a\nci: b\n";
    throw new Error("unexpected");
  };
  const decision = decide({ repoDir: "/tmp", exec });
  assert.equal(decision.release, false);
  assert.equal(decision.tag, null);
});

test("without any tag the sequence starts from the version in package.json", () => {
  const exec = (_command, args) => {
    if (args[0] === "tag") return "\n";
    if (args[0] === "log") return "fix: one\n";
    throw new Error("unexpected");
  };
  const decision = decide({ repoDir: "/tmp", exec, fallbackVersion: "0.3.0" });
  assert.equal(decision.previous, "0.3.0");
  assert.equal(decision.version, "0.3.1");
});
