import { describe, expect, it, vi } from "vitest";
import { hashChain } from "../src/audit.js";
import {
  generateApiKey,
  hashKey,
  mintConfirmation,
  open,
  seal,
  verifyConfirmation,
  verifyKey,
} from "../src/crypto.js";
import { diffManifest, manifestFor } from "../src/fingerprints.js";
import { newId } from "../src/ids.js";
import { can } from "../src/permissions.js";
import { costCents } from "../src/pricing.js";
import { parseTamOsReceipt } from "../src/receipts.js";

const masterKey = Buffer.alloc(32, 7).toString("base64");

describe("ids", () => {
  it("creates prefixed uuidv7 ids", () => {
    expect(newId("proj")).toMatch(/^proj_[0-9a-f]{32}$/);
  });
});

describe("permissions", () => {
  it("supports exact and wildcard grants", () => {
    expect(can(["projects:read"], "projects:read")).toBe(true);
    expect(can(["projects:*"], "projects:write")).toBe(true);
    expect(can(["*"], "roles:write")).toBe(true);
    expect(can(["projects:read"], "projects:write")).toBe(false);
  });
});

describe("pricing", () => {
  it("rounds half up and returns null for unknown models", () => {
    expect(
      costCents({ model: "gpt-5.5-mini", inputTokens: 1_000_000, outputTokens: 1_000_000 }),
    ).toBe(225);
    expect(costCents({ model: "missing", inputTokens: 1, outputTokens: 1 })).toBeNull();
  });

  it("resolves dated provider model ids to a price", () => {
    // What Anthropic actually returns in usage — must still cost out.
    expect(
      costCents({ model: "claude-haiku-4-5-20251001", inputTokens: 1_000_000, outputTokens: 0 }),
    ).toBe(80);
    expect(
      costCents({ model: "gpt-5.5-2025-11-01", inputTokens: 1_000_000, outputTokens: 0 }),
    ).toBe(1000);
  });
});

describe("crypto", () => {
  it("seals and opens plaintext", async () => {
    const sealed = await seal("secret", masterKey);
    expect(await open(sealed, masterKey)).toBe("secret");
  });

  it("hashes and verifies API keys", async () => {
    const hash = await hashKey("fak_secret");
    expect(await verifyKey("fak_secret", hash)).toBe(true);
    expect(await verifyKey("wrong", hash)).toBe(false);
    const key = await generateApiKey("fak");
    expect(key.secret).toMatch(/^fak_[0-9a-f]{40}$/);
    expect(key.last4).toBe(key.secret.slice(-4));
  });

  it("rejects expired and tampered confirmations", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const token = mintConfirmation({
      secret: "confirm",
      userId: "user_1",
      clientId: "client",
      toolName: "write",
      argsHash: "abc",
      summary: "do it",
      ttlMs: 1_000,
    });
    expect(verifyConfirmation(token, "confirm")?.userId).toBe("user_1");
    expect(verifyConfirmation(`${token.slice(0, -1)}x`, "confirm")).toBeNull();
    vi.advanceTimersByTime(1_001);
    expect(verifyConfirmation(token, "confirm")).toBeNull();
    vi.useRealTimers();
  });
});

describe("fingerprints", () => {
  it("diffs manifests within managed paths", () => {
    const expected = manifestFor([
      { path: "a", content: "one" },
      { path: "b", content: "two" },
    ]);
    const actual = manifestFor([
      { path: "a", content: "changed" },
      { path: "c", content: "extra" },
    ]);
    expect(diffManifest(expected, actual, ["a", "b", "c"])).toEqual({
      missing: ["b"],
      modified: ["a"],
      extra: ["c"],
    });
  });
});

describe("audit", () => {
  it("hashes deterministically", () => {
    const first = hashChain(null, { b: 2, a: 1 });
    expect(hashChain(null, { a: 1, b: 2 })).toBe(first);
    expect(hashChain(first, { a: 1 })).not.toBe(first);
  });
});

describe("receipts", () => {
  it("maps tam-os receipts to facility receipts", () => {
    const receipt = parseTamOsReceipt({
      schema: "tam-os.agent_sdlc.run.v1",
      provider: "codex_cli",
      mode: "builder",
      result: "succeeded",
      usage: { input_tokens: 100, output_tokens: 50, cost_usd: 1.235, cost_source: "provider" },
      activity: { turns: 2, shell_commands: 1, file_changes: 3, mcp_tool_calls: 0, errors: 0 },
      github: { owner: "theam", repo: "tam-os", actor: "octo" },
      timing: { started_at: "2026-01-01T00:00:00Z", duration_ms: 1000 },
    });
    expect(receipt.schema).toBe("facility.run.v1");
    expect(receipt.usage.cost_cents).toBe(124);
    expect(receipt.github?.actor_sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});
