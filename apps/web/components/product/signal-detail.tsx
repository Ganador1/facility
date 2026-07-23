"use client";

import Link from "next/link";
import { type LinkArtifact, Markdown } from "@/components/markdown";
import { type KbEntry, stripFrontmatter } from "@/lib/kb";

/** A Signal is raw captured input: provenance first, then the capture itself. */
export function SignalDetail({
  entry,
  projectId,
  reviewRunId,
  linkArtifact,
}: {
  entry: KbEntry;
  projectId: string;
  reviewRunId: string | null;
  linkArtifact: LinkArtifact;
}) {
  const provenance =
    entry.frontmatter.provenance && typeof entry.frontmatter.provenance === "object"
      ? (entry.frontmatter.provenance as Record<string, unknown>)
      : {};
  const source =
    typeof entry.frontmatter.source === "string"
      ? entry.frontmatter.source
      : typeof provenance.source === "string"
        ? (provenance.source as string)
        : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5 border border-(--line) bg-(--card) px-4 py-3 text-[11.5px]">
        <span className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-(--dim)">
          provenance
        </span>
        <div className="flex flex-wrap gap-x-5 gap-y-1 font-mono text-(--mut)">
          {source ? <span>source: {source}</span> : null}
          {typeof provenance.receivedAt === "string" ? (
            <span>received: {(provenance.receivedAt as string).slice(0, 16)}</span>
          ) : null}
          {typeof provenance.by === "string" ? <span>by: {provenance.by as string}</span> : null}
          {reviewRunId ? (
            <Link
              href={`/projects/${projectId}/sessions/${reviewRunId}`}
              className="text-(--info) underline underline-offset-4"
            >
              review run →
            </Link>
          ) : (
            <span className="text-(--dim)">no review run</span>
          )}
        </div>
      </div>
      <div className="border border-(--line) bg-(--bg-subtle) p-5">
        <Markdown source={stripFrontmatter(entry.bodyMd)} linkArtifact={linkArtifact} />
      </div>
    </div>
  );
}
