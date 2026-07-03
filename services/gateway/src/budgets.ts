import { newId } from "@facility/core";
import type { FacilityDb } from "@facility/db";
import { budgets, platformIssues, spendCounters } from "@facility/db";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import type { AuthedKey, BudgetState } from "./types.js";

type BudgetDef = {
  id: string;
  orgId: string;
  projectId: string | null;
  agentDefId: string | null;
  scope: string;
  period: BudgetState["period"];
  limitCents: number;
  mode: BudgetState["mode"];
};
// Cache the budget DEFINITIONS (they change rarely). Spend is NEVER cached —
// it is read live from spend_counters on every request so a hard budget sees
// committed spend the instant any prior request meters it (finding #2). The
// counter increment in metering.ts is an atomic UPSERT, so the only residual
// race is genuinely-simultaneous in-flight requests, bounded by their count.
const budgetDefCache = new Map<string, { expiresAt: number; defs: BudgetDef[] }>();

export async function applicableBudgets(
  db: FacilityDb,
  key: AuthedKey,
  now: Date,
): Promise<BudgetState[]> {
  const cacheKey = `${key.orgId}:${key.projectId}:${key.runId ?? "none"}:${key.budgetId ?? "none"}`;
  let defs = budgetDefCache.get(cacheKey);
  if (!defs || defs.expiresAt <= Date.now()) {
    const filters = [
      eq(budgets.scope, "org"),
      and(eq(budgets.scope, "project"), eq(budgets.projectId, key.projectId)),
    ];
    if (key.agentDefId) {
      filters.push(and(eq(budgets.scope, "agent_def"), eq(budgets.agentDefId, key.agentDefId)));
    }
    if (key.budgetId) {
      filters.push(eq(budgets.id, key.budgetId));
    }
    const rows = await db
      .select()
      .from(budgets)
      .where(and(eq(budgets.orgId, key.orgId), eq(budgets.enabled, true), or(...filters)));
    defs = {
      expiresAt: Date.now() + 30_000,
      defs: rows.map((row) => ({
        id: row.id,
        orgId: row.orgId,
        projectId: row.projectId,
        agentDefId: row.agentDefId,
        scope: row.scope,
        period: row.period as BudgetState["period"],
        limitCents: row.limitCents,
        mode: row.mode as BudgetState["mode"],
      })),
    };
    budgetDefCache.set(cacheKey, defs);
  }

  if (defs.defs.length === 0) return [];

  const windowByBudget = new Map(defs.defs.map((def) => [def.id, windowStart(def.period, now)]));
  const counters = await db
    .select()
    .from(spendCounters)
    .where(
      and(
        eq(spendCounters.orgId, key.orgId),
        inArray(
          spendCounters.budgetId,
          defs.defs.map((def) => def.id),
        ),
      ),
    );
  const spentByBudget = new Map(
    counters
      .filter((row) => row.windowStart === windowByBudget.get(row.budgetId))
      .map((row) => [row.budgetId, row.spentCents]),
  );

  return defs.defs.map((def) => ({
    ...def,
    windowStart: windowByBudget.get(def.id) ?? windowStart(def.period, now),
    spentCents: spentByBudget.get(def.id) ?? 0,
  }));
}

export function hardBudgetBlock(states: BudgetState[]): BudgetState | null {
  return (
    states.find((budget) => budget.mode === "hard" && budget.spentCents >= budget.limitCents) ??
    null
  );
}

export async function emitSoftBudgetIssues(db: FacilityDb, states: BudgetState[], key: AuthedKey) {
  const breached = states.filter(
    (budget) => budget.mode === "soft" && budget.spentCents >= budget.limitCents,
  );
  for (const budget of breached) {
    const fingerprint = `budget.warned:${budget.id}:${budget.windowStart}`;
    await db
      .insert(platformIssues)
      .values({
        id: newId("iss"),
        orgId: key.orgId,
        projectId: key.projectId,
        kind: "budget_breach",
        severity: "warn",
        fingerprint,
        title: "Soft budget breached",
        bodyMd: `Budget ${budget.id} has reached ${budget.spentCents}/${budget.limitCents} cents for ${budget.windowStart}.`,
      })
      .onConflictDoUpdate({
        target: [platformIssues.orgId, platformIssues.fingerprint],
        set: { lastSeen: new Date(), count: sql`${platformIssues.count} + 1` },
      });
  }
}

export function clearBudgetCache() {
  budgetDefCache.clear();
}

export function windowStart(period: string, now: Date): string {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (period === "monthly") {
    date.setUTCDate(1);
  } else if (period === "weekly") {
    const day = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() - day + 1);
  }
  return date.toISOString().slice(0, 10);
}
