import type { FacilityDb } from "@facility/db";
import { runEvents } from "@facility/db";
import { eq, sql } from "drizzle-orm";
import type { SandboxDriverName } from "./driver.js";

export type RunnerEngine = "claude_code" | "codex" | "byo";

export type RunBundle = {
  runId: string;
  mode: string;
  engine: RunnerEngine;
  contract: string;
  skills: Array<{ name: string; content: string }>;
  engineConfig: Record<string, unknown>;
  repo: {
    cloneUrl: string | null;
    branch: string | null;
    installationTokenRef: string | null;
  };
  provisionCmd: string | null;
  checkCmds: string[];
  gatewayUrls: { anthropic: string; openai: string };
  scope: Record<string, unknown>;
  timeoutMin: number;
  harness?: { files: Record<string, string> };
};

export type RunSandboxState = {
  driver?: SandboxDriverName;
  ref?: string;
  image?: string;
  runnerTokenHash?: string;
  virtualKeyId?: string;
  sealedVirtualKey?: string;
  virtualKeyRevealedAt?: string;
  platformKeyId?: string;
  sealedPlatformKey?: string;
  projectId?: string;
  bundle?: RunBundle;
  launchedAt?: string;
  finishedAt?: string;
  lastStatus?: string;
};

export function readSandbox(value: unknown): RunSandboxState {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RunSandboxState)
    : {};
}

// Terminal run statuses — the race-safe guard for every lifecycle UPDATE so a
// stale write can't move a finished run back to an active state.
export const TERMINAL_RUN_STATUSES = ["succeeded", "failed", "canceled"] as const;

export function terminalStatus(status: string) {
  return (TERMINAL_RUN_STATUSES as readonly string[]).includes(status);
}

export async function nextRunEventSeq(db: FacilityDb, runId: string): Promise<number> {
  const rows = await db
    .select({ max: sql<number>`coalesce(max(seq), 0)` })
    .from(runEvents)
    .where(eq(runEvents.runId, runId));
  return Number(rows[0]?.max ?? 0) + 1;
}

export async function appendRunEvents(
  db: FacilityDb,
  orgId: string,
  runId: string,
  events: Array<{ type: string; data?: Record<string, unknown>; ts?: string }>,
) {
  if (events.length === 0) return [];
  const start = await nextRunEventSeq(db, runId);
  const values = events.map((event, index) => ({
    orgId,
    runId,
    seq: start + index,
    type: event.type,
    data: event.data ?? {},
    ts: event.ts ? new Date(event.ts) : undefined,
  }));
  const inserted = await db.insert(runEvents).values(values).returning();
  for (const event of inserted) {
    await notifyRunEvent(db, runId, event);
  }
  return inserted;
}

export async function notifyRunEvent(db: FacilityDb, runId: string, event: unknown) {
  await db.execute(sql`select pg_notify(${`run_events:${runId}`}, ${JSON.stringify(event)})`);
}
