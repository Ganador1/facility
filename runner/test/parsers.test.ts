import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseClaudeStreamJsonLine, parseCodexJsonlLine } from "../src/parsers.js";

const fixtureRoot = join(import.meta.dirname, "fixtures");

describe("engine parsers", () => {
  it("maps Claude Code 2.1.199 stream-json without raw payload dumps", async () => {
    const lines = (await readFile(join(fixtureRoot, "claude-code-2.1.199.stream-json"), "utf8"))
      .trim()
      .split("\n");
    const events = lines.map(parseClaudeStreamJsonLine);
    expect(events.map((event) => event?.type)).toEqual(["assistant", "tool", "engine_result"]);
    expect(events[1]?.data?.name).toBe("Bash");
    expect(String(events[1]?.data?.input).length).toBeLessThanOrEqual(503);
  });

  it("maps Codex 0.142.5 JSONL without raw payload dumps", async () => {
    const lines = (await readFile(join(fixtureRoot, "codex-0.142.5.jsonl"), "utf8"))
      .trim()
      .split("\n");
    const events = lines.map(parseCodexJsonlLine);
    expect(events.map((event) => event?.type)).toEqual(["assistant", "tool", "engine_result"]);
    expect(events[1]?.data?.name).toBe("shell");
    expect(String(events[1]?.data?.input).length).toBeLessThanOrEqual(503);
  });
});
