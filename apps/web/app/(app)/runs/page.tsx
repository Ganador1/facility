import { Offline } from "@/components/offline";
import { fetchAllRuns, fmtAgo, fmtCost, fmtDuration } from "@/lib/runs";
import { Eyebrow, StatusDot, toneFor } from "@facility/ui";
import Link from "next/link";

export const metadata = { title: "runs" };

export default async function RunsPage() {
  const { offline, runs } = await fetchAllRuns();
  if (offline) return <Offline />;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <Eyebrow>runs</Eyebrow>
        <h1 className="text-[clamp(24px,3.6vw,40px)] font-semibold leading-[1.08] tracking-[-0.02em]">
          Every run leaves a receipt.
        </h1>
      </div>

      {runs.length === 0 ? (
        <p className="text-sm text-(--dim)">No runs yet.</p>
      ) : (
        <div className="overflow-x-auto border border-(--line)">
          <table className="w-full min-w-[720px] border-collapse text-left">
            <thead>
              <tr className="border-b border-(--line)">
                {["run", "status", "engine", "duration", "cost", "when"].map((h) => (
                  <th key={h} className="px-5 py-3 font-mono text-[10px] font-medium uppercase tracking-[0.2em] text-(--dim)">
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
      )}
    </div>
  );
}
