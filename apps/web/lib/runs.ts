import { api, type Project, type Run } from "./api";

export type RunWithProject = Run & { project: Pick<Project, "id" | "name" | "slug"> };

/** Org-wide runs view: fan out per project (projects are few; runs are the hot axis). */
export async function fetchAllRuns(params = ""): Promise<{
  offline: boolean;
  projects: Project[];
  runs: RunWithProject[];
}> {
  const projects = await api.projects();
  if (!projects.ok) return { offline: projects.offline, projects: [], runs: [] };

  const perProject = await Promise.all(
    projects.data.items.map(async (project) => {
      const runs = await api.runs(project.id, params);
      if (!runs.ok) return [];
      return runs.data.items.map((run) => ({
        ...run,
        project: { id: project.id, name: project.name, slug: project.slug },
      }));
    }),
  );

  const runs = perProject
    .flat()
    .sort((a, b) => (b.queuedAt ?? "").localeCompare(a.queuedAt ?? ""));
  return { offline: false, projects: projects.data.items, runs };
}

export function fmtCost(cents?: number | null): string {
  if (cents == null) return "—";
  return `$${(cents / 100).toFixed(2)}`;
}

export function fmtDuration(start?: string | null, end?: string | null): string {
  if (!start) return "—";
  const ms = (end ? new Date(end) : new Date()).getTime() - new Date(start).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "<1m";
  if (min < 60) return `${min}m`;
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}

export function fmtAgo(iso?: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
