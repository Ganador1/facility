type ModelPrice = {
    input: number;
    output: number;
    cacheRead?: number;
    cacheWrite?: number;
};
declare const MODEL_PRICES_USD_PER_1M: {
    readonly "claude-fable-5": {
        readonly input: 15;
        readonly output: 75;
        readonly cacheRead: 1.5;
        readonly cacheWrite: 18.75;
    };
    readonly "claude-opus-4-8": {
        readonly input: 15;
        readonly output: 75;
        readonly cacheRead: 1.5;
        readonly cacheWrite: 18.75;
    };
    readonly "claude-sonnet-5": {
        readonly input: 3;
        readonly output: 15;
        readonly cacheRead: 0.3;
        readonly cacheWrite: 3.75;
    };
    readonly "claude-haiku-4-5": {
        readonly input: 0.8;
        readonly output: 4;
        readonly cacheRead: 0.08;
        readonly cacheWrite: 1;
    };
    readonly "gpt-5.5": {
        readonly input: 10;
        readonly output: 30;
        readonly cacheRead: 1;
        readonly cacheWrite: 10;
    };
    readonly "gpt-5.5-mini": {
        readonly input: 0.25;
        readonly output: 2;
        readonly cacheRead: 0.025;
        readonly cacheWrite: 0.25;
    };
    readonly custom: {
        readonly input: 0;
        readonly output: 0;
        readonly cacheRead: 0;
        readonly cacheWrite: 0;
    };
};
type CostInput = {
    model: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
};
declare function costCents(input: CostInput): number | null;

export { type CostInput, MODEL_PRICES_USD_PER_1M, type ModelPrice, costCents };
