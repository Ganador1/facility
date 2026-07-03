import { Transform, type TransformCallback } from "node:stream";
import type { Provider, Usage } from "./types.js";

export function emptyUsage(): Usage {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
}

function mergeUsage(target: Usage, usage: Partial<Usage>) {
  target.inputTokens = usage.inputTokens ?? target.inputTokens;
  target.outputTokens = usage.outputTokens ?? target.outputTokens;
  target.cacheReadTokens = usage.cacheReadTokens ?? target.cacheReadTokens;
  target.cacheWriteTokens = usage.cacheWriteTokens ?? target.cacheWriteTokens;
}

export function usageFromJson(provider: Provider, body: unknown): Partial<Usage> {
  if (!body || typeof body !== "object") return {};
  const usage = (body as { usage?: unknown }).usage;
  if (!usage || typeof usage !== "object") return {};
  const row = usage as Record<string, unknown>;
  if (provider === "anthropic") {
    return {
      inputTokens: numberValue(row.input_tokens),
      outputTokens: numberValue(row.output_tokens),
      cacheReadTokens: numberValue(row.cache_read_input_tokens),
      cacheWriteTokens: numberValue(row.cache_creation_input_tokens),
    };
  }
  return {
    inputTokens: numberValue(row.input_tokens),
    outputTokens: numberValue(row.output_tokens),
    cacheReadTokens: nestedNumber(row.input_tokens_details, "cached_tokens"),
    cacheWriteTokens: nestedNumber(row.input_tokens_details, "cache_creation_tokens"),
  };
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function nestedNumber(value: unknown, key: string): number | undefined {
  if (!value || typeof value !== "object") return undefined;
  return numberValue((value as Record<string, unknown>)[key]);
}

export class UsageTee extends Transform {
  readonly usage = emptyUsage();
  readonly textParts: string[] = [];
  private pending = "";

  constructor(private provider: Provider) {
    super();
  }

  _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback) {
    const text = chunk.toString("utf8");
    this.textParts.push(text);
    this.pending += text;
    this.parsePending();
    this.push(chunk);
    callback();
  }

  _flush(callback: TransformCallback) {
    this.parsePending(true);
    callback();
  }

  responseBody(contentType: string | undefined): unknown {
    const text = this.textParts.join("");
    if (contentType?.includes("application/json")) {
      try {
        return JSON.parse(text);
      } catch {
        return { raw: text };
      }
    }
    return { raw: text, usage: this.usage };
  }

  private parsePending(force = false) {
    while (true) {
      const index = this.pending.indexOf("\n\n");
      if (index === -1) break;
      const frame = this.pending.slice(0, index);
      this.pending = this.pending.slice(index + 2);
      this.parseSseFrame(frame);
    }
    if (force && this.pending.trim()) {
      this.parseJsonText(this.pending);
      this.pending = "";
    }
  }

  private parseSseFrame(frame: string) {
    const dataLines = frame
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trimStart());
    for (const data of dataLines) {
      if (!data || data === "[DONE]") continue;
      this.parseJsonText(data);
    }
  }

  private parseJsonText(text: string) {
    try {
      const parsed = JSON.parse(text);
      if (this.provider === "anthropic") {
        const direct = usageFromJson("anthropic", parsed);
        const delta = usageFromJson("anthropic", { usage: parsed.delta?.usage });
        mergeUsage(this.usage, { ...direct, ...delta });
      } else {
        mergeUsage(this.usage, usageFromJson("openai", parsed));
      }
    } catch {
      // Provider bytes are still passed through; malformed telemetry frames only affect metering.
    }
  }
}
