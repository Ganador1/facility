import { api, type Project, type Run } from "./api";

export { fmtAgo, fmtCost, fmtDuration } from "./run-format";

export type RunWithProject = Run & { project: Pick<Project, "id" | "name" | "slug"> };

export async function fetchAllRuns(params = ""): Promise<{
  offline: boolean;
  projects: Project[];
  runs: RunWithProject[];
}> {
  const [projects, runs] = await Promise.all([api.projects(), api.allRuns(params)]);
  if (!projects.ok) return { offline: projects.offline, projects: [], runs: [] };
  if (!runs.ok) return { offline: runs.offline, projects: projects.data, runs: [] };

  return { offline: false, projects: projects.data, runs: runs.data };
}
