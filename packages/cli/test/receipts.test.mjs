import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  collectReceipt,
  verifyReceipt,
  writeReceipt,
} from "../templates/receipts/collect.mjs";

test("collects a privacy-preserving, tamper-evident agent receipt", async () => {
  const dir = await mkdtemp(join(tmpdir(), "facility-receipt-"));
  const eventPath = join(dir, "event.json");
  const enginePath = join(dir, "engine.jsonl");
  const outputPath = join(dir, "receipt.json");
  writeFileSync(eventPath, JSON.stringify({ pull_request: { number: 42 } }));
  writeFileSync(
    enginePath,
    [
      JSON.stringify({ type: "turn.completed", usage: { input_tokens: 10, output_tokens: 4 } }),
      JSON.stringify({ type: "item.completed", item: { type: "command_execution" } }),
    ].join("\n"),
  );
  const env = {
    FACILITY_RECEIPT_PROVIDER: "codex_cli",
    FACILITY_RECEIPT_MODE: "review",
    FACILITY_RECEIPT_RESULT: "success",
    FACILITY_RECEIPT_STARTED_AT: "2026-07-19T00:00:00.000Z",
    FACILITY_RECEIPT_ENGINE_JSONL: enginePath,
    FACILITY_RECEIPT_OUTPUT: outputPath,
    GITHUB_EVENT_PATH: eventPath,
    GITHUB_REPOSITORY: "theam/mirror",
    GITHUB_ACTOR: "reviewer",
    GITHUB_RUN_ID: "123",
    GITHUB_RUN_ATTEMPT: "1",
    GITHUB_JOB: "review",
  };
  const receipt = collectReceipt(env, new Date("2026-07-19T00:01:00.000Z"));
  assert.equal(receipt.schema, "facility.run.v1");
  assert.equal(receipt.github.pr, 42);
  assert.equal(receipt.usage.input_tokens, 10);
  assert.equal(receipt.activity.turns, 1);
  assert.equal(receipt.activity.shell_commands, 1);
  assert.equal(receipt.github.actor, undefined);
  assert.match(receipt.github.actor_sha256, /^[0-9a-f]{64}$/);
  assert.equal(verifyReceipt(receipt), true);
  assert.equal(verifyReceipt({ ...receipt, result: "failed" }), false);
  assert.equal(
    verifyReceipt({ ...receipt, integrity: { ...receipt.integrity, attestation: "forged" } }),
    false,
  );
  assert.equal(writeReceipt(receipt, env), outputPath);
});
