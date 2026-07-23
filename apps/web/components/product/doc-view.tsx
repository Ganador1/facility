"use client";

import { Button, PillTag } from "@facility/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { type LinkArtifact, Markdown } from "@/components/markdown";
import { CopyRef } from "@/components/product/copy-ref";
import { DecisionDetail } from "@/components/product/decision-detail";
import { MarkdownEditor } from "@/components/product/markdown-editor";
import { SignalDetail } from "@/components/product/signal-detail";
import { ValidationReportPanel } from "@/components/product/validation-report";
import { artifactIdFor, type KbEntry, type KbSpace, splitFrontmatter } from "@/lib/kb";
import { type Neighborhood, patchEntry, saveSpace, type ValidationReport } from "@/lib/kb-client";

/** Dispatcher: charter/active, decision, signal, or a generic document page. */
export function DocView({
  doc,
  entry,
  space,
  projectId,
  canWrite,
  neighborhood,
  signalRunId,
  linkArtifact,
  onNavigate,
}: {
  doc: string;
  entry: KbEntry | null;
  space: KbSpace;
  projectId: string;
  canWrite: boolean;
  neighborhood: Neighborhood | null;
  signalRunId: string | null;
  linkArtifact: LinkArtifact;
  onNavigate: (artifactId: string) => void;
}) {
  if (doc === "charter" || doc === "active") {
    return (
      <PinView
        kind={doc}
        space={space}
        projectId={projectId}
        canWrite={canWrite}
        linkArtifact={linkArtifact}
      />
    );
  }
  if (!entry) {
    return (
      <p className="border border-(--line) px-5 py-4 text-[12.5px] text-(--dim)">
        No page selected — pick one from the tree.
      </p>
    );
  }

  const header = (
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-mono text-[13px] font-medium text-(--ink)">{artifactIdFor(entry)}</span>
      <CopyRef artifactId={artifactIdFor(entry)} />
      <span className="text-[13px] text-(--mut)">{entry.slug.replaceAll("-", " ")}</span>
      {entry.status && entry.type !== "D" ? <PillTag>{entry.status}</PillTag> : null}
    </div>
  );

  if (entry.type === "D") {
    return (
      <div className="flex min-w-0 flex-col gap-3">
        {header}
        <DecisionDetail
          entry={entry}
          neighborhood={neighborhood}
          canWrite={canWrite}
          linkArtifact={linkArtifact}
          onNavigate={onNavigate}
        />
      </div>
    );
  }
  if (entry.type === "S") {
    return (
      <div className="flex min-w-0 flex-col gap-3">
        {header}
        <SignalDetail
          entry={entry}
          projectId={projectId}
          reviewRunId={signalRunId}
          linkArtifact={linkArtifact}
        />
      </div>
    );
  }
  return (
    <DocumentView
      key={entry.id}
      entry={entry}
      header={header}
      canWrite={canWrite && entry.type === "R"}
      linkArtifact={linkArtifact}
    />
  );
}

function PinView({
  kind,
  space,
  projectId,
  canWrite,
  linkArtifact,
}: {
  kind: "charter" | "active";
  space: KbSpace;
  projectId: string;
  canWrite: boolean;
  linkArtifact: LinkArtifact;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const raw = kind === "charter" ? space.charterMd : space.activeMd;
  const { frontmatter, body } = splitFrontmatter(raw);

  async function save(markdown: string) {
    setBusy(true);
    setNote(null);
    const res = await saveSpace(projectId, {
      charterMd: kind === "charter" ? frontmatter + markdown : space.charterMd,
      activeMd: kind === "active" ? frontmatter + markdown : space.activeMd,
    });
    setBusy(false);
    if (!res.ok) {
      setNote(res.error.message);
      return;
    }
    setEditing(false);
    router.refresh();
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[12.5px] font-medium text-(--dim)">{kind}</span>
        {canWrite && !editing ? (
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            edit {kind}
          </Button>
        ) : null}
      </div>
      {editing ? (
        <MarkdownEditor
          initial={body}
          saveLabel={`save ${kind}`}
          busy={busy}
          note={note}
          hint="steering the Owner: this is its memory, re-read every session"
          onSave={(md) => void save(md)}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <div className="max-h-[68vh] overflow-auto border border-(--line) bg-(--bg-subtle) p-5">
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

function DocumentView({
  entry,
  header,
  canWrite,
  linkArtifact,
}: {
  entry: KbEntry;
  header: React.ReactNode;
  canWrite: boolean;
  linkArtifact: LinkArtifact;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [report, setReport] = useState<ValidationReport | null>(null);
  const { frontmatter, body } = splitFrontmatter(entry.bodyMd);

  async function save(markdown: string) {
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
    setEditing(false);
    router.refresh();
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        {header}
        {canWrite && !editing ? (
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            edit
          </Button>
        ) : null}
      </div>
      {report ? <ValidationReportPanel report={report} /> : null}
      {editing ? (
        <MarkdownEditor
          initial={body}
          saveLabel="save page"
          busy={busy}
          note={note}
          onSave={(md) => void save(md)}
          onCancel={() => {
            setEditing(false);
            setReport(null);
          }}
        />
      ) : (
        <div className="max-h-[68vh] overflow-auto border border-(--line) bg-(--bg-subtle) p-5">
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
