"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Markdown } from "@/components/markdown";
import { DocView } from "@/components/product/doc-view";
import { type EntryVersion, MetaRail } from "@/components/product/meta-rail";
import { NavTree } from "@/components/product/nav-tree";
import { NewEntry } from "@/components/product/new-entry";
import {
  artifactIdFor,
  groupSections,
  type KbDecision,
  type KbEntry,
  type KbSpace,
  stripFrontmatter,
} from "@/lib/kb";
import { fetchNeighborhood, type Neighborhood } from "@/lib/kb-client";

/**
 * The Product workspace: page tree · document · properties. Selection is URL
 * state (?doc=D001) so artifact links deep-link and survive refreshes.
 */
export function ProductWorkspace({
  projectId,
  space,
  entries,
  decisions,
  signalRuns,
  canWrite,
}: {
  projectId: string;
  space: KbSpace;
  entries: KbEntry[];
  decisions: KbDecision[];
  signalRuns: Record<string, string>;
  canWrite: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [creating, setCreating] = useState<"R" | "D" | null>(null);
  const [hood, setHood] = useState<Neighborhood | null>(null);
  const [railOpen, setRailOpen] = useState(false);
  const [previewVersion, setPreviewVersion] = useState<EntryVersion | null>(null);

  const byArtifactId = useMemo(() => {
    const map = new Map<string, KbEntry>();
    for (const entry of entries) map.set(artifactIdFor(entry), entry);
    return map;
  }, [entries]);

  const sections = useMemo(() => groupSections(entries), [entries]);
  const doc = searchParams.get("doc") ?? "active";
  const entry = doc === "charter" || doc === "active" ? null : (byArtifactId.get(doc) ?? null);

  const navigate = useCallback(
    (next: string) => {
      setCreating(null);
      setPreviewVersion(null);
      router.replace(`?doc=${encodeURIComponent(next)}`, { scroll: false });
    },
    [router],
  );

  // Neighborhood powers the meta rail + decision chains; fetched per entry.
  useEffect(() => {
    let cancelled = false;
    setHood(null);
    if (!entry) return;
    void fetchNeighborhood(entry.id).then((res) => {
      if (!cancelled && res.ok) setHood(res.data);
    });
    return () => {
      cancelled = true;
    };
  }, [entry]);

  const linkArtifact = useCallback(
    (id: string) => {
      if (id === "ACTIVE") return "?doc=active";
      if (id === "CHARTER") return "?doc=charter";
      return byArtifactId.has(id) ? `?doc=${encodeURIComponent(id)}` : null;
    },
    [byArtifactId],
  );

  const signalRunId = entry ? (signalRuns[entry.id] ?? null) : null;

  return (
    <div className="grid h-full min-h-0 gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
      <div className="min-h-0 overflow-y-auto pr-1">
        <NavTree
          sections={sections}
          decisions={decisions}
          selected={creating ? "" : doc}
          canWrite={canWrite}
          onSelect={navigate}
          onNew={(type) => setCreating(type)}
        />
      </div>

      <div className="relative min-h-0 min-w-0">
        {entry && !creating ? (
          <button
            type="button"
            onClick={() => setRailOpen((v) => !v)}
            className="absolute right-2 top-0 z-20 border border-(--line) bg-(--bg) px-2 py-1 font-mono text-[10.5px] text-(--dim) hover:text-(--ink)"
            title="page properties, links & history"
          >
            {railOpen ? "properties ×" : "properties"}
          </button>
        ) : null}

        <div className="h-full min-h-0 overflow-y-auto pr-1">
          {previewVersion ? (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-3 border border-(--line) bg-(--card) px-4 py-2.5">
                <span className="font-mono text-[11px] text-(--human)">
                  viewing v{previewVersion.version} ·{" "}
                  {previewVersion.createdAt.slice(0, 16).replace("T", " ")}
                </span>
                <button
                  type="button"
                  onClick={() => setPreviewVersion(null)}
                  className="font-mono text-[11px] text-(--info,--mut) underline-offset-2 hover:underline"
                >
                  back to current
                </button>
              </div>
              <div className="border border-(--line) bg-(--bg-subtle) p-5">
                <Markdown source={stripFrontmatter(previewVersion.bodyMd)} />
              </div>
            </div>
          ) : creating ? (
            <div className="flex flex-col gap-3">
              <span className="text-[12.5px] font-medium text-(--dim)">
                new {creating === "D" ? "decision" : "documentation page"}
              </span>
              <NewEntry
                projectId={projectId}
                type={creating}
                entries={entries}
                onCreated={(artifactId) => {
                  setCreating(null);
                  navigate(artifactId);
                }}
                onCancel={() => setCreating(null)}
              />
            </div>
          ) : (
            <DocView
              doc={doc}
              entry={entry}
              space={space}
              projectId={projectId}
              canWrite={canWrite}
              neighborhood={hood}
              signalRunId={signalRunId}
              linkArtifact={linkArtifact}
              onNavigate={navigate}
            />
          )}
        </div>

        {railOpen && entry && !creating ? (
          <aside className="absolute inset-y-0 right-0 z-10 w-[280px] overflow-y-auto border-l border-(--line) bg-(--bg) p-4 shadow-[-12px_0_40px_rgba(0,0,0,0.35)]">
            <MetaRail
              entry={entry}
              neighborhood={hood}
              onNavigate={navigate}
              onPreviewVersion={(version) => {
                setPreviewVersion(version);
                setRailOpen(false);
              }}
            />
          </aside>
        ) : null}
      </div>
    </div>
  );
}
