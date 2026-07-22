import { untypedApi } from "./api";
import type { PipelineIssue } from "./pipeline";

type IssuePage<T> = { items: T[]; nextCursor?: string | null };

export type ProjectIssuesResult<T> =
  | { ok: true; items: T[]; truncated: boolean }
  | { ok: false; offline: boolean; status: number; message: string };

// 20 pages × 100 = 2000 mirrored issues before we stop — far beyond any board
// we render today, and the truncation is reported instead of silent.
const MAX_PAGES = 20;
const PAGE_SIZE = 100;

/**
 * Fetch the project's complete issue mirror, following pagination. Pipeline
 * classification over a single default page silently drops older items from
 * both the stage lists and the counts.
 */
export async function fetchAllProjectIssues<T extends PipelineIssue = PipelineIssue>(
  projectId: string,
): Promise<ProjectIssuesResult<T>> {
  const items: T[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const query = new URLSearchParams({ state: "all", limit: String(PAGE_SIZE) });
    if (cursor) query.set("cursor", cursor);
    const res = await untypedApi<IssuePage<T>>(
      "GET",
      `/v1/projects/${projectId}/issues?${query.toString()}`,
    );
    if (!res.ok) {
      // A partial board beats an empty one, but a first-page failure is real.
      if (page === 0)
        return { ok: false, offline: res.offline, status: res.status, message: res.message };
      return { ok: true, items, truncated: true };
    }
    items.push(...res.data.items);
    cursor = res.data.nextCursor ?? null;
    if (!cursor) return { ok: true, items, truncated: false };
  }
  return { ok: true, items, truncated: true };
}
