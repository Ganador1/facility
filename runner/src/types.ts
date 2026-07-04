export type RunBundle = {
  runId: string;
  mode: string;
  engine: "claude_code" | "codex" | "byo";
  contract: string;
  skills: Array<{ name: string; content: string }>;
  engineConfig: Record<string, unknown>;
  repo: { cloneUrl: string | null; branch: string | null; installationTokenRef: string | null };
  harness?: { files: Record<string, string> } | null;
  provisionCmd: string | null;
  checkCmds: string[];
  gatewayUrls: { anthropic: string; openai: string };
  scope: Record<string, unknown>;
  timeoutMin: number;
};

export type RunEvent = {
  type: string;
  data?: Record<string, unknown>;
  ts?: string;
};
