"use client";

import { PillTag } from "@facility/ui";
import { artifactIdFor, type KbEntry, TYPE_LABELS } from "@/lib/kb";
import type { Neighborhood } from "@/lib/kb-client";

/**
 * The Notion "page properties" analog: identity, status, dates, and the
 * validator-enforced link graph of the selected entry.
 */
export function MetaRail({
  entry,
  neighborhood,
  onNavigate,
}: {
  entry: KbEntry;
  neighborhood: Neighborhood | null;
  onNavigate: (artifactId: string) => void;
}) {
  const supersedes = neighborhood?.linked.filter((n) => n.relation === "supersedes") ?? [];
  const supersededBy = neighborhood?.linked.filter((n) => n.relation === "superseded-by") ?? [];
  const linked = neighborhood?.linked.filter((n) => n.relation === "linked") ?? [];

  const groups: { label: string; items: typeof linked }[] = [
    { label: "supersedes", items: supersedes },
    { label: "superseded by", items: supersededBy },
    { label: "links", items: linked },
  ];

  return (
    <aside className="flex flex-col gap-5 text-[12px]">
      <div className="flex flex-col gap-2">
        <span className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-(--dim)">
          properties
        </span>
        <dl className="flex flex-col gap-1.5">
          <MetaRow label="id" value={artifactIdFor(entry)} mono />
          <MetaRow label="type" value={TYPE_LABELS[entry.type] ?? entry.type} />
          {entry.status ? (
            <div className="flex items-baseline justify-between gap-2">
              <dt className="text-(--dim)">status</dt>
              <dd>
                <PillTag>{entry.status}</PillTag>
              </dd>
            </div>
          ) : null}
          {entry.createdAt ? (
            <MetaRow label="created" value={fmtDate(entry.createdAt)} mono />
          ) : null}
          {entry.updatedAt ? (
            <MetaRow label="updated" value={fmtDate(entry.updatedAt)} mono />
          ) : null}
        </dl>
      </div>
      {groups.map((group) =>
        group.items.length > 0 ? (
          <div key={group.label} className="flex flex-col gap-1.5">
            <span className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-(--dim)">
              {group.label}
            </span>
            <div className="flex flex-col gap-1">
              {group.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onNavigate(item.artifactId)}
                  className="flex items-baseline gap-2 text-left text-(--mut) hover:text-(--ink)"
                >
                  <span className="shrink-0 font-mono text-[10.5px] text-(--dim)">
                    {item.artifactId}
                  </span>
                  <span className="min-w-0 truncate">{item.slug.replaceAll("-", " ")}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null,
      )}
    </aside>
  );
}

function MetaRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-(--dim)">{label}</dt>
      <dd className={mono ? "font-mono text-[11px] text-(--mut)" : "text-(--mut)"}>{value}</dd>
    </div>
  );
}

function fmtDate(iso: string): string {
  return iso.slice(0, 10);
}
