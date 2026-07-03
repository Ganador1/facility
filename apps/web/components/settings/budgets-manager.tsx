"use client";

import { Button, Field, Select, TextInput } from "@facility/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Budget } from "@/lib/api";

const money = (cents: number) => `$${(cents / 100).toFixed(0)}`;

/** Org-level budgets: soft warns, hard stops the gateway. */
export function BudgetsManager({ budgets }: { budgets: Budget[] }) {
  const router = useRouter();
  const [limit, setLimit] = useState("");
  const [period, setPeriod] = useState<"daily" | "weekly" | "monthly">("monthly");
  const [mode, setMode] = useState<"soft" | "hard">("soft");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/budgets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scope: "org",
          period,
          mode,
          limitCents: Math.round(Number(limit) * 100),
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(body?.error?.message ?? `failed (${res.status})`);
      }
      setLimit("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <form onSubmit={create} className="flex flex-wrap items-end gap-3">
        <Field label="limit (usd)">
          <TextInput
            required
            type="number"
            min="1"
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            placeholder="500"
            className="w-28"
          />
        </Field>
        <Field label="period">
          <Select value={period} onChange={(e) => setPeriod(e.target.value as typeof period)}>
            <option value="daily">daily</option>
            <option value="weekly">weekly</option>
            <option value="monthly">monthly</option>
          </Select>
        </Field>
        <Field label="mode">
          <Select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
            <option value="soft">soft — warn</option>
            <option value="hard">hard — stop</option>
          </Select>
        </Field>
        <Button type="submit" variant="primary" disabled={busy || !limit}>
          {busy ? "adding…" : "add budget"}
        </Button>
      </form>
      {error ? <p className="font-mono text-[11px] text-(--bad)">{error}</p> : null}

      {budgets.length === 0 ? (
        <p className="text-sm text-(--dim)">No budgets. Spend is uncapped.</p>
      ) : (
        <div className="flex flex-col border border-(--line)">
          {budgets.map((b) => (
            <div
              key={b.id}
              className="flex items-center gap-4 border-b border-(--line) px-4 py-3 last:border-b-0"
            >
              <span className="tabular font-mono text-[13px] text-(--ink)">
                {money(b.limitCents)}
              </span>
              <span className="font-mono text-[11px] text-(--dim)">/ {b.period}</span>
              <span
                className="font-mono text-[10px] uppercase tracking-[0.16em]"
                style={{ color: b.mode === "hard" ? "var(--bad)" : "var(--human)" }}
              >
                {b.mode}
              </span>
              <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.16em] text-(--dim)">
                {b.scope}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
