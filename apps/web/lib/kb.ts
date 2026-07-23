/**
 * Shared KB view-model helpers for the Product tab. The server owns the
 * canonical versions of these rules (packages/harness/src/validate.ts,
 * chain.ts) — this file mirrors only what display needs, and says so where
 * it does.
 */

export type KbEntry = {
  id: string;
  type: string;
  number: number;
  slug: string;
  frontmatter: Record<string, unknown>;
  bodyMd: string;
  status: string | null;
  supersedes: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type KbSpace = {
  charterMd: string;
  activeMd: string;
};

export type KbDecision = KbEntry & {
  artifactId: string;
  supersededBy: string | null;
  active: boolean;
};

export type KbNeighbor = {
  id: string;
  artifactId: string;
  type: string;
  number: number;
  slug: string;
  status: string | null;
  relation: "supersedes" | "superseded-by" | "linked";
};

export const TYPE_LABELS: Record<string, string> = {
  S: "signals",
  D: "decisions",
  T: "tasks",
  V: "verifications",
  R: "documentation",
  H: "hypotheses",
  E: "experiments",
  F: "findings",
  L: "learnings",
  CR: "change requests",
  SR: "status reports",
};

/** Mirror of packages/harness/src/validate.ts artifactIdFor — keep in sync. */
export function artifactIdFor(entry: Pick<KbEntry, "type" | "number" | "frontmatter">): string {
  const id = entry.frontmatter?.id;
  if (typeof id === "string" && id.trim()) return id.trim();
  return `${entry.type}${String(entry.number).padStart(3, "0")}`;
}

const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

/** Display-only: YAML frontmatter is metadata, not prose — never render it raw. */
export function stripFrontmatter(md: string): string {
  const match = md.match(FRONTMATTER_RE);
  return match ? md.slice(match[0].length) : md;
}

/**
 * Editing round-trip: the editor works on prose only; the original
 * frontmatter block (if any) is re-attached verbatim on save.
 */
export function splitFrontmatter(md: string): { frontmatter: string; body: string } {
  const match = md.match(FRONTMATTER_RE);
  if (!match) return { frontmatter: "", body: md };
  return { frontmatter: match[0], body: md.slice(match[0].length) };
}

export type KbSection = {
  key: string;
  label: string;
  entries: KbEntry[];
  /** Collapsed by default in the nav (pipeline artifacts, research chain). */
  secondary: boolean;
};

const PRIMARY_ORDER = ["D", "R", "S"] as const;
const PIPELINE_TYPES = new Set(["T", "V"]);

/**
 * Section layout of the nav tree: Decisions, Documentation, Signals as
 * first-class sections; pipeline artifacts (T/V) and any research-chain
 * types grouped as secondary.
 */
export function groupSections(entries: KbEntry[]): KbSection[] {
  const byType = new Map<string, KbEntry[]>();
  for (const entry of entries) {
    byType.set(entry.type, [...(byType.get(entry.type) ?? []), entry]);
  }

  // Primary sections always render — an empty Decisions section with its
  // "+ new" affordance is the onboarding, not a gap to hide.
  const PRIMARY_LABELS: Record<string, string> = {
    D: "decisions (ADRs)",
    R: "documentation",
    S: "signals",
  };
  const sections: KbSection[] = [];
  for (const type of PRIMARY_ORDER) {
    const list = byType.get(type) ?? [];
    byType.delete(type);
    sections.push({
      key: type,
      label: PRIMARY_LABELS[type] ?? TYPE_LABELS[type] ?? type,
      entries: sortForSection(type, list),
      secondary: false,
    });
  }

  const pipeline: KbEntry[] = [];
  for (const type of PIPELINE_TYPES) {
    const list = byType.get(type);
    if (!list) continue;
    byType.delete(type);
    pipeline.push(...list);
  }
  if (pipeline.length > 0) {
    pipeline.sort((a, b) => a.type.localeCompare(b.type) || b.number - a.number);
    sections.push({ key: "TV", label: "pipeline artifacts", entries: pipeline, secondary: true });
  }

  for (const [type, list] of [...byType.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    sections.push({
      key: type,
      label: TYPE_LABELS[type] ?? type,
      entries: sortForSection(type, list),
      secondary: true,
    });
  }
  return sections;
}

function sortForSection(type: string, list: KbEntry[]): KbEntry[] {
  if (type === "R") return [...list].sort((a, b) => a.slug.localeCompare(b.slug));
  return [...list].sort((a, b) => b.number - a.number);
}
