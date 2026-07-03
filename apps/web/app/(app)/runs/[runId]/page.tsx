import { Cell, Eyebrow, HairlineGrid, Metric, StatusDot, toneFor } from "@facility/ui";
import { ErrorNotice, Offline } from "@/components/offline";
import { RunTranscript } from "@/components/run/transcript";
import { api } from "@/lib/api";
import { fmtCost, fmtDuration } from "@/lib/runs";

export const metadata = { title: "run" };

const LIVE = new Set(["queued", "provisioning", "running", "awaiting_human"]);

export default async function RunPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const [run, me] = await Promise.all([api.run(runId), api.me()]);

  if (!run.ok) {
    return run.offline ? <Offline /> : <ErrorNotice message={`run not found (${run.status})`} />;
  }

  const r = run.data;
  const live = LIVE.has(r.status);
  const canSteer =
    me.ok && me.data.permissions.some((p) => p === "*" || p === "runs:*" || p === "runs:steer");
  const usage = r.receipt?.usage;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <Eyebrow>run · {r.id}</Eyebrow>
        <div className="flex flex-wrap items-center gap-4">
          <h1 className="font-mono text-[clamp(20px,3vw,32px)] font-semibold tracking-tight">
            {r.mode}
          </h1>
          <span className="inline-flex items-center gap-2 font-mono text-[12px] uppercase tracking-[0.14em] text-(--mut)">
            <StatusDot tone={toneFor(r.status)} pulse={r.status === "running"} />
            {r.status}
          </span>
          <span className="font-mono text-[12px] text-(--dim)">{r.engine}</span>
        </div>
        {r.error ? <ErrorNotice message={r.error} /> : null}
      </div>

      <HairlineGrid cols="grid-cols-2 lg:grid-cols-4">
        <Cell className="p-5">
          <Metric label="duration" value={fmtDuration(r.startedAt, r.endedAt)} />
        </Cell>
        <Cell className="p-5">
          <Metric
            label="tokens in / out"
            value={
              usage?.input_tokens != null
                ? `${((usage.input_tokens ?? 0) / 1000).toFixed(0)}k / ${((usage.output_tokens ?? 0) / 1000).toFixed(0)}k`
                : "—"
            }
          />
        </Cell>
        <Cell className="p-5">
          <Metric label="cost" value={fmtCost(usage?.cost_cents)} />
        </Cell>
        <Cell className="p-5">
          <Metric
            label="artifact"
            value={r.gh?.pr ? "PR" : r.gh?.issue ? "issue" : "—"}
            hint={r.gh?.pr ?? r.gh?.issue ?? undefined}
          />
        </Cell>
      </HairlineGrid>

      <RunTranscript runId={r.id} live={live} canSteer={Boolean(canSteer)} />
    </div>
  );
}
