import { Cell, Eyebrow, HairlineGrid, Metric } from "@facility/ui";
import { ErrorNotice, Offline } from "@/components/offline";
import { api, summarizeSpend } from "@/lib/api";
import { fetchAllRuns, fmtCost } from "@/lib/runs";

export const metadata = { title: "analytics" };

const DASH = "—";

export default async function AnalyticsPage() {
  const [{ offline, error: runsError, runs }, spendByModel, spendByAgent] = await Promise.all([
    fetchAllRuns(),
    api.spend("?groupBy=model"),
    api.spend("?groupBy=agent"),
  ]);
  if (offline) return <Offline />;

  const terminal = runs.filter((r) => ["succeeded", "failed", "canceled"].includes(r.status));
  const succeeded = terminal.filter((r) => r.status === "succeeded").length;
  const successRate = terminal.length ? Math.round((succeeded / terminal.length) * 100) : null;
  const totalCents = spendByModel.ok ? summarizeSpend(spendByModel.data).totalCents : null;

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-2">
        <Eyebrow>analytics</Eyebrow>
        <h1 className="text-[clamp(24px,3.6vw,40px)] font-semibold leading-[1.08] tracking-[-0.02em]">
          Numbers straight from the pipeline.
        </h1>
        <p className="max-w-xl text-sm leading-relaxed text-(--mut)">
          Computed from stored runs and gateway receipts — never curated for a slide. Outcome
          metrics (acceptance, one-shot, fixups) join in as the watchtower collects them.
        </p>
      </div>

      {runsError ? <ErrorNotice message={`Couldn't load runs — ${runsError}`} /> : null}

      <HairlineGrid cols="grid-cols-2 lg:grid-cols-4">
        <Cell>
          <Metric label="runs · total" value={runsError ? DASH : runs.length} />
        </Cell>
        <Cell>
          <Metric
            label="run success"
            value={runsError || successRate == null ? DASH : `${successRate}%`}
            tone={!runsError && successRate != null && successRate >= 80 ? "ok" : undefined}
            hint={
              runsError
                ? "runs didn't load"
                : terminal.length
                  ? `${succeeded}/${terminal.length} terminal runs`
                  : "no terminal runs yet"
            }
          />
        </Cell>
        <Cell>
          <Metric label="spend" value={totalCents == null ? DASH : fmtCost(totalCents)} />
        </Cell>
        <Cell>
          <Metric
            label="projects reporting"
            value={runsError ? DASH : new Set(runs.map((r) => r.project.id)).size}
          />
        </Cell>
      </HairlineGrid>

      <div className="grid gap-8 lg:grid-cols-2">
        {(
          [
            ["by model", spendByModel],
            ["by agent", spendByAgent],
          ] as const
        ).map(([label, spend]) => {
          const summary = spend.ok ? summarizeSpend(spend.data) : { totalCents: 0, groups: [] };
          return (
            <section key={label} className="flex flex-col gap-4">
              <Eyebrow>cost {label}</Eyebrow>
              {!spend.ok ? (
                <ErrorNotice message={`Couldn't load spend — ${spend.message}`} />
              ) : summary.groups.length === 0 ? (
                <p className="text-sm text-(--dim)">No gateway traffic yet.</p>
              ) : (
                <div className="flex flex-col gap-3">
                  {summary.groups.map((group) => {
                    const pct = summary.totalCents
                      ? Math.round((group.cents / summary.totalCents) * 100)
                      : 0;
                    return (
                      <div key={group.key} className="flex flex-col gap-1.5">
                        <div className="flex items-baseline justify-between font-mono text-[12px]">
                          <span className="text-(--ink)">{group.key}</span>
                          <span className="tabular text-(--mut)">
                            {fmtCost(group.cents)} · {pct}%
                          </span>
                        </div>
                        <div className="h-1 w-full bg-(--card)">
                          <div className="h-full bg-(--machine)" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
