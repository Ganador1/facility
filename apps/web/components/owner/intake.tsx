"use client";

import { Button } from "@facility/ui";
import Link from "next/link";
import { useState } from "react";

type IntakeResult = { artifactId: string; runId: string | null };

/**
 * Feed the Product Owner a raw capture — a meeting transcript, a note, a
 * scope-change email. It lands in the KB as a Signal with provenance and
 * dispatches a review run whose proposed changes arrive as approvals.
 */
export function OwnerIntake({ projectId }: { projectId: string }) {
  const [title, setTitle] = useState("");
  const [source, setSource] = useState("meeting");
  const [bodyMd, setBodyMd] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<IntakeResult | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/kb/intake`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, source, bodyMd, dispatch: true }),
      });
      const data = (await res.json().catch(() => null)) as
        | (IntakeResult & { error?: { message?: string } })
        | null;
      if (!res.ok) throw new Error(data?.error?.message ?? `intake failed (${res.status})`);
      if (data) setResult({ artifactId: data.artifactId, runId: data.runId });
      setTitle("");
      setBodyMd("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "intake failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 border border-(--line) p-4">
      <p className="text-[11.5px] leading-relaxed text-(--dim)">
        Paste a transcript or note with scope changes. It lands in the KB with provenance and the
        Owner reviews the backlog against it — every proposed change arrives as an approval.
      </p>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="title — e.g. Weekly sync 2026-07-22"
        aria-label="Capture title"
        className="border border-(--line) bg-(--bg-subtle) px-3 py-2 text-[12.5px] text-(--ink) outline-none focus:border-(--line-strong)"
      />
      <input
        value={source}
        onChange={(e) => setSource(e.target.value)}
        placeholder="source — meeting, email, slack…"
        aria-label="Capture source"
        className="border border-(--line) bg-(--bg-subtle) px-3 py-2 text-[12.5px] text-(--ink) outline-none focus:border-(--line-strong)"
      />
      <textarea
        value={bodyMd}
        onChange={(e) => setBodyMd(e.target.value)}
        rows={6}
        placeholder="the raw capture, verbatim…"
        aria-label="Capture body"
        className="border border-(--line) bg-(--bg-subtle) p-3 font-mono text-[12px] leading-relaxed text-(--ink) outline-none focus:border-(--line-strong)"
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          variant="primary"
          tone="agent"
          disabled={busy || title.trim().length < 3 || bodyMd.trim().length < 10}
          onClick={() => void submit()}
        >
          {busy ? "sending…" : "send to the Owner"}
        </Button>
        {error ? <span className="font-mono text-[11px] text-(--bad)">{error}</span> : null}
        {result ? (
          <span className="font-mono text-[11px] text-(--mut)">
            stored as {result.artifactId}
            {result.runId ? (
              <>
                {" · "}
                <Link
                  href={`/projects/${projectId}/sessions/${result.runId}`}
                  className="text-(--info) underline-offset-4 hover:underline"
                >
                  review run →
                </Link>
              </>
            ) : null}
          </span>
        ) : null}
      </div>
    </div>
  );
}
