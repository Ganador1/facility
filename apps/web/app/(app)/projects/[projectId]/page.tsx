import { ErrorNotice, Offline } from "@/components/offline";
import { api } from "@/lib/api";
import { fmtAgo, fmtCost, fmtDuration } from "@/lib/runs";
import { Cell, Eyebrow, HairlineGrid, Metric, StatusDot, toneFor } from "@facility/ui";
import Link from "next/link";

export const metadata = { title: "project" };

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const [project, runs, spend] = await Promise.all([
    api.project(projectId),
    api.runs(projectId),
    api.spend(`?projectId=${projectId}&groupBy=model`),
  ]);

  if (!project.ok) {
    return project.offline ? (
      <Offline />
    ) : (
      <ErrorNotice message={`project not found (${project.status})`} />
    );
  }

  const p = project.data;
  const items = runs.ok ? runs.data.items : [];
  const live = items.filter((r) => ["queued", "provisioning", "running"].includes(r.status));
  const settings = (p.settings ?? {}) as {
    default_branch?: string;
    provision_cmd?: string;
    check_cmds?: string[];
  };

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-2">
        <Eyebrow>project</Eyebrow>
        <h1 className="font-mono text-[clamp(22px,3.4vw,36px)] font-semibold tracking-tight">
          {p.slug}
        </h1>
        {p.description ? (
          <p className="max-w-xl text-sm leading-relaxed text-(--mut)">{p.description}</p>
        ) : null}
      </div>

      <HairlineGrid cols="grid-cols-2 lg:grid-cols-4">
        <Cell className="p-5">
          <Metric label="agents live" value={live.length} tone={live.length ? "agent" : undefined} />
        </Cell>
        <Cell className="p-5">
          <Metric label="runs" value={items.length} />
        </Cell>
        <Cell className="p-5">
          <Metric label="spend" value={spend.ok ? fmtCost(spend.data.totalCents) : "—"} />
        </Cell>
        <Cell className="p-5">
          <Metric label="system" value={p.systemVersion ?? "unpinned"} />
        </Cell>
      </HairlineGrid>

      <section className="flex flex-col gap-4">
        <Eyebrow>recent runs</Eyebrow>
        {items.length === 0 ? (
          <p className="text-sm text-(--dim)">No runs in this project yet.</p>
        ) : (
          <div className="flex flex-col border border-(--line)">
            {items.slice(0, 12).map((run) => (
              <Link
                key={run.id}
                href={`/runs/${run.id}`}
                className="flex items-center gap-4 border-b border-(--line) px-5 py-3.5 transition-colors last:border-b-0 hover:bg-(--card)"
              >
                <StatusDot tone={toneFor(run.status)} pulse={run.status === "running"} />
                <span className="font-mono text-[13px] text-(--ink)">{run.mode}</span>
                <span className="font-mono text-[11px] text-(--dim)">{run.engine}</span>
                <span className="ml-auto hidden font-mono text-[11px] text-(--mut) sm:inline">
                  {fmtDuration(run.startedAt, run.endedAt)}
                </span>
                <span className="font-mono text-[11px] text-(--dim)">{fmtAgo(run.queuedAt)}</span>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="flex max-w-2xl flex-col gap-4">
        <Eyebrow>provisioned site</Eyebrow>
        <div className="flex flex-col gap-3 border border-(--line) p-6 font-mono text-[12.5px]">
          <div className="flex justify-between gap-6">
            <span className="text-(--dim)">default branch</span>
            <span className="text-(--code)">{settings.default_branch ?? "main"}</span>
          </div>
          <div className="flex justify-between gap-6">
            <span className="text-(--dim)">provision</span>
            <span className="truncate text-(--code)">{settings.provision_cmd ?? "—"}</span>
          </div>
          <div className="flex justify-between gap-6">
            <span className="shrink-0 text-(--dim)">checks</span>
            <span className="text-right text-(--code)">
              {settings.check_cmds?.length ? settings.check_cmds.join(" · ") : "—"}
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}
