// src/pricing.ts
var MODEL_PRICES_USD_PER_1M = {
  "claude-fable-5": { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  "claude-opus-4-8": { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  "claude-sonnet-5": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  "claude-haiku-4-5": { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 },
  "gpt-5.5": { input: 10, output: 30, cacheRead: 1, cacheWrite: 10 },
  "gpt-5.5-mini": { input: 0.25, output: 2, cacheRead: 0.025, cacheWrite: 0.25 },
  custom: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
};
function costCents(input) {
  const price = MODEL_PRICES_USD_PER_1M[input.model];
  if (!price) {
    return null;
  }
  const usd = input.inputTokens / 1e6 * price.input + input.outputTokens / 1e6 * price.output + (input.cacheReadTokens ?? 0) / 1e6 * (price.cacheRead ?? 0) + (input.cacheWriteTokens ?? 0) / 1e6 * (price.cacheWrite ?? 0);
  return Math.floor(usd * 100 + 0.5);
}

export {
  MODEL_PRICES_USD_PER_1M,
  costCents
};
