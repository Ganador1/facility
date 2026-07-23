"use client";

import { Button, PillTag, StatusDot } from "@facility/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { type LinkArtifact, Markdown } from "@/components/markdown";
import { CopyRef } from "@/components/product/copy-ref";
import { MarkdownEditor } from "@/components/product/markdown-editor";
import { ValidationReportPanel } from "@/components/product/validation-report";
import { artifactIdFor, type KbEntry, splitFrontmatter } from "@/lib/kb";
import { type Neighborhood, patchEntry, type ValidationReport } from "@/lib/kb-client";

/**
 * A decision record: status, its place in the supersedence chain, and direct
 * editing — every edit preserves the prior content as a version.
 */
export function DecisionDetail({
  entry,
  neighborhood,
  canWrite,
  linkArtifact,
  onNavigate,
}: {
  entry: KbEntry;
  neighborhood: Neighborhood | null;
  canWrite: boolean;
  linkArtifact: LinkArtifact;
  onNavigate: (artifactId: string) => void;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"read" | "edit">("read");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [report, setReport] = useState<ValidationReport | null>(null);

  const artifactId = artifactIdFor(entry);
  const superseded = entry.status === "superseded";
  const decided = entry.status === "decided";
  const successor = neighborhood?.linked.find((n) => n.relation === "superseded-by") ?? null;
  const predecessor = neighborhood?.linked.find((n) => n.relation === "supersedes") ?? null;
  const { frontmatter, body } = splitFrontmatter(entry.bodyMd);

  async function submitEdit(markdown: string) {
    setBusy(true);
    setNote(null);
    setReport(null);
    const res = await patchEntry(entry.id, { bodyMd: frontmatter + markdown });
    setBusy(false);
    if (!res.ok) {
      setNote(res.error.message);
      if (res.error.report) setReport(res.error.report);
      return;
    }
    setMode("read");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3 border border-(--line) bg-(--card) px-4 py-3">
        <StatusDot tone={superseded ? "machine" : decided ? "ok" : "human"} />
        <CopyRef artifactId={artifactId} />
        {entry.status ? <PillTag>{entry.status}</PillTag> : null}
        {superseded && successor ? (
          <button
            type="button"
            onClick={() => onNavigate(successor.artifactId)}
            className="font-mono text-[11px] text-(--info) underline underline-offset-4"
          >
            superseded by {successor.artifactId} →
          </button>
        ) : null}
        {predecessor ? (
          <button
            type="button"
            onClick={() => onNavigate(predecessor.artifactId)}
            className="font-mono text-[11px] text-(--mut) underline-offset-4 hover:underline"
          >
            ← supersedes {predecessor.artifactId}
          </button>
        ) : null}
        <span className="ml-auto text-[11px] text-(--dim)">
          {superseded
            ? "retired — kept for the record"
            : decided
              ? "editable — every edit keeps the previous version"
              : "proposed — editable until decided"}
        </span>
        {canWrite && mode === "read" ? (
          <Button size="sm" variant="outline" onClick={() => setMode("edit")}>
            edit
          </Button>
        ) : null}
      </div>

      {report ? <ValidationReportPanel report={report} /> : null}

      {mode === "edit" ? (
        <MarkdownEditor
          initial={body}
          saveLabel="save decision"
          busy={busy}
          note={note}
          hint="every edit keeps the previous version in history"
          onSave={(md) => void submitEdit(md)}
          onCancel={() => {
            setMode("read");
            setNote(null);
            setReport(null);
          }}
        />
      ) : (
        <div className="border border-(--line) bg-(--bg-subtle) p-5">
          {body.trim() ? (
            <Markdown source={body} linkArtifact={linkArtifact} />
          ) : (
            <p className="font-mono text-[12.5px] text-(--dim)">(empty)</p>
          )}
        </div>
      )}
    </div>
  );
}
