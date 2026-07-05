import { Eyebrow, StatusDot, toneFor } from "@facility/ui";
import Link from "next/link";
import { ErrorNotice, Offline } from "@/components/offline";
import { fetchAllRuns, fmtAgo, fmtCost, fmtDuration } from "@/lib/runs";

export const metadata = { title: "runs" };

export default async function RunsPage() {
  const { offline, error, runs } = await fetchAllRuns();
  if (offline) return <Offline />;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <Eyebrow>runs</Eyebrow>
        <h1 className="text-[clamp(24px,3.6vw,40px)] font-semibold leading-[1.08] tracking-[-0.02em]">
          Every run leaves a receipt.
        </h1>
      </div>

      {error ? (
        <ErrorNotice message={`Couldn't load runs — ${error}`} />
      ) : runs.length === 0 ? (
        <p className="text-sm text-(--dim)">No runs yet.</p>
      ) : (
        <>
          <div className="flex flex-col gap-3 sm:hidden">
            {runs.map((run) => (
              <article key={run.id} className="border border-(--line) bg-(--bg)">
                <div className="border-b border-(--line) px-4 py-3">
                  <Link
                    href={`/runs/${run.id}`}
                    className="break-words font-mono text-[13px] text-(--ink) underline-offset-4 hover:underline"
                  >
                    {run.project.slug}/{run.mode}
                  </Link>
                </div>
                <dl className="grid gap-px bg-(--line)">
                  <div className="flex items-center justify-between gap-4 bg-(--bg) px-4 py-3">
                    <dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-(--dim)">
                      status
                    </dt>
                    <dd className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-(--mut)">
                      <StatusDot tone={toneFor(run.status)} pulse={run.status === "running"} />
                      {run.status}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-4 bg-(--bg) px-4 py-3">
                    <dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-(--dim)">
                      engine
                    </dt>
                    <dd className="break-words text-right font-mono text-[11px] text-(--mut)">
                      {run.engine}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-4 bg-(--bg) px-4 py-3">
                    <dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-(--dim)">
                      duration
                    </dt>
                    <dd className="font-mono text-[11px] text-(--mut)">
                      {fmtDuration(run.startedAt, run.endedAt)}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-4 bg-(--bg) px-4 py-3">
                    <dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-(--dim)">
                      cost
                    </dt>
                    <dd className="tabular font-mono text-[11px] text-(--mut)">
                      {fmtCost(run.receipt?.usage?.cost_cents)}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-4 bg-(--bg) px-4 py-3">
                    <dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-(--dim)">
                      when
                    </dt>
                    <dd className="font-mono text-[11px] text-(--dim)">{fmtAgo(run.queuedAt)}</dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>

          <div className="hidden overflow-x-auto border border-(--line) sm:block">
            <table className="w-full min-w-[720px] border-collapse text-left">
              <thead>
                <tr className="border-b border-(--line)">
                  {["run", "status", "engine", "duration", "cost", "when"].map((h) => (
                    <th
                      key={h}
                      className="px-5 py-3 font-mono text-[10px] font-medium uppercase tracking-[0.2em] text-(--dim)"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id} className="group border-b border-(--line) last:border-b-0">
                    <td className="px-5 py-3.5">
                      <Link
                        href={`/runs/${run.id}`}
                        className="font-mono text-[13px] text-(--ink) group-hover:underline group-hover:underline-offset-4"
                      >
                        {run.project.slug}/{run.mode}
                      </Link>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-(--mut)">
                        <StatusDot tone={toneFor(run.status)} pulse={run.status === "running"} />
                        {run.status}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 font-mono text-[11px] text-(--mut)">{run.engine}</td>
                    <td className="px-5 py-3.5 font-mono text-[11px] text-(--mut)">
                      {fmtDuration(run.startedAt, run.endedAt)}
                    </td>
                    <td className="tabular px-5 py-3.5 font-mono text-[11px] text-(--mut)">
                      {fmtCost(run.receipt?.usage?.cost_cents)}
                    </td>
                    <td className="px-5 py-3.5 font-mono text-[11px] text-(--dim)">
                      {fmtAgo(run.queuedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
