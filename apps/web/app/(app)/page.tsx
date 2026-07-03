import { Cell, Divider, Eyebrow, HairlineGrid, Metric, StatusDot, toneFor } from "@facility/ui";
import Link from "next/link";
import { Offline } from "@/components/offline";
import { api, summarizeSpend } from "@/lib/api";
import { fetchAllRuns, fmtAgo, fmtCost, fmtDuration } from "@/lib/runs";

export const metadata = { title: "overview" };

export default async function OverviewPage() {
  const [{ offline, projects, runs }, inbox, spend] = await Promise.all([
    fetchAllRuns(),
    api.inbox(),
    api.spend("?groupBy=day"),
  ]);

  if (offline) return <Offline />;

  const live = runs.filter((r) => ["queued", "provisioning", "running"].includes(r.status));
  const needsHuman = runs.filter((r) => r.status === "awaiting_human");
  const openProposals = inbox.ok ? inbox.data : [];
  const monthCents = spend.ok ? summarizeSpend(spend.data).totalCents : null;

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-2">
        <Eyebrow>overview</Eyebrow>
        <h1 className="text-[clamp(24px,3.6vw,40px)] font-semibold leading-[1.08] tracking-[-0.02em]">
          The factory floor.
        </h1>
      </div>

      <HairlineGrid cols="grid-cols-2 lg:grid-cols-4">
        <Cell>
          <Metric
            label="agents live"
            value={live.length}
            tone={live.length ? "agent" : undefined}
          />
        </Cell>
        <Cell>
          <Metric
            label="needs you"
            value={openProposals.length + needsHuman.length}
            tone={openProposals.length + needsHuman.length ? "human" : undefined}
            hint="open gates + blocked runs"
          />
        </Cell>
        <Cell>
          <Metric label="projects" value={projects.length} />
        </Cell>
        <Cell>
          <Metric
            label="spend · mtd"
            value={monthCents == null ? "—" : fmtCost(monthCents)}
            hint="straight from the gateway, never curated"
          />
        </Cell>
      </HairlineGrid>

      <section className="flex flex-col gap-4">
        <div className="flex items-baseline justify-between">
          <Eyebrow>running now</Eyebrow>
          <Link
            href="/runs"
            className="font-mono text-[10.5px] uppercase tracking-[0.2em] text-(--mut) hover:text-(--ink)"
          >
            all runs →
          </Link>
        </div>
        {live.length === 0 ? (
          <p className="text-sm text-(--dim)">
            No agent is working right now. Trigger a run from a project, or comment{" "}
            <code className="font-mono text-(--code)">/architect</code> on an issue.
          </p>
        ) : (
          <div className="flex flex-col border border-(--line)">
            {live.map((run) => (
              <Link
                key={run.id}
                href={`/runs/${run.id}`}
                className="flex items-center gap-4 border-b border-(--line) px-5 py-4 transition-colors last:border-b-0 hover:bg-(--card)"
              >
                <StatusDot tone={toneFor(run.status)} pulse={run.status === "running"} />
                <span className="font-mono text-[13px] text-(--ink)">
                  {run.project.slug}/{run.mode}
                </span>
                <span className="hidden font-mono text-[11px] text-(--dim) sm:inline">
                  {run.engine}
                </span>
                <span className="ml-auto font-mono text-[11px] text-(--mut)">
                  {fmtDuration(run.startedAt, null)}
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>

      <Divider />

      <section className="flex flex-col gap-4">
        <div className="flex items-baseline justify-between">
          <Eyebrow>needs a decision</Eyebrow>
          <Link
            href="/inbox"
            className="font-mono text-[10.5px] uppercase tracking-[0.2em] text-(--mut) hover:text-(--ink)"
          >
            inbox →
          </Link>
        </div>
        {openProposals.length === 0 ? (
          <p className="text-sm text-(--dim)">Nothing is waiting on you. Both gates are clear.</p>
        ) : (
          <div className="flex flex-col border border-(--line)">
            {openProposals.slice(0, 6).map((p) => (
              <Link
                key={p.id}
                href={`/inbox?focus=${p.id}`}
                className="flex items-center gap-4 border-b border-(--line) px-5 py-4 transition-colors last:border-b-0 hover:bg-(--card)"
              >
                <StatusDot tone="human" />
                <span className="min-w-0 flex-1 truncate text-sm text-(--ink)">
                  <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-(--human)">
                    {p.actionType}
                  </span>{" "}
                  <span className="text-(--mut)">· {fmtAgo(p.createdAt)}</span>
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-4">
        <Eyebrow>projects</Eyebrow>
        <HairlineGrid cols="sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <Cell key={project.id} interactive className="p-0">
              <Link href={`/projects/${project.id}`} className="block h-full w-full p-6 sm:p-8">
                <div className="flex flex-col gap-3">
                  <span className="font-mono text-[13px] font-medium text-(--ink)">
                    {project.slug}
                  </span>
                  <span className="line-clamp-2 text-[13px] leading-relaxed text-(--mut)">
                    {project.description ?? "—"}
                  </span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-(--dim)">
                    system {project.systemVersion ?? "unpinned"}
                  </span>
                </div>
              </Link>
            </Cell>
          ))}
          {projects.length === 0 ? (
            <Cell>
              <p className="text-sm text-(--dim)">
                No projects yet.{" "}
                <Link href="/projects" className="text-(--ink) underline underline-offset-4">
                  Kickstart the first one.
                </Link>
              </p>
            </Cell>
          ) : null}
        </HairlineGrid>
      </section>
    </div>
  );
}
