"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DocView } from "@/components/product/doc-view";
import { MetaRail } from "@/components/product/meta-rail";
import { NavTree } from "@/components/product/nav-tree";
import { NewEntry } from "@/components/product/new-entry";
import { ThreadView } from "@/components/product/thread-view";
import {
  artifactIdFor,
  groupSections,
  type KbDecision,
  type KbEntry,
  type KbSpace,
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
  threads,
  canWrite,
}: {
  projectId: string;
  space: KbSpace;
  entries: KbEntry[];
  decisions: KbDecision[];
  signalRuns: Record<string, string>;
  threads: { id: string; title: string | null; updatedAt?: string }[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [creating, setCreating] = useState<"R" | "D" | null>(null);
  const [hood, setHood] = useState<Neighborhood | null>(null);

  const byArtifactId = useMemo(() => {
    const map = new Map<string, KbEntry>();
    for (const entry of entries) map.set(artifactIdFor(entry), entry);
    return map;
  }, [entries]);

  const sections = useMemo(() => groupSections(entries), [entries]);
  const doc = searchParams.get("doc") ?? "active";
  const threadId = doc.startsWith("thread:") ? doc.slice("thread:".length) : null;
  const thread = threadId ? (threads.find((t) => t.id === threadId) ?? null) : null;
  const entry =
    doc === "charter" || doc === "active" || threadId ? null : (byArtifactId.get(doc) ?? null);

  const navigate = useCallback(
    (next: string) => {
      setCreating(null);
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
    <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)] xl:grid-cols-[260px_minmax(0,1fr)_240px]">
      <NavTree
        sections={sections}
        decisions={decisions}
        threads={threads}
        selected={creating ? "" : doc}
        canWrite={canWrite}
        onSelect={navigate}
        onNew={(type) => setCreating(type)}
      />

      <div className="min-w-0">
        {threadId && !creating ? (
          <ThreadView
            projectId={projectId}
            conversationId={threadId}
            title={thread?.title ?? null}
          />
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

      <div className="hidden xl:block">
        {entry && !creating ? (
          <MetaRail entry={entry} neighborhood={hood} onNavigate={navigate} />
        ) : null}
      </div>
    </div>
  );
}
