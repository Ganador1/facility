"use client";

import { Button } from "@facility/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { AskPanel } from "./ask-panel";

/** Pastes longer than this offer the intake path instead of a chat message. */
const PASTE_INTAKE_CHARS = 1_500;

type IntakeReceipt = { artifactId: string; runId: string | null };

/**
 * The omnipresent ask bar: one input, on every project page. Questions go to
 * the in-process Product Owner; long pastes offer the governed intake path.
 */
export function AskBar({ projectId }: { projectId: string }) {
  const [value, setValue] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [pendingPaste, setPendingPaste] = useState<string | null>(null);
  const [intakeReceipt, setIntakeReceipt] = useState<IntakeReceipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const storageKey = `facility-ask-thread:${projectId}`;

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(storageKey);
      if (stored) setConversationId(stored);
    } catch {
      // Session storage unavailable (SSR/private mode) — threads reset per load.
    }
  }, [storageKey]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (event.key === "/" && !typing) {
        event.preventDefault();
        inputRef.current?.focus();
      }
      if (event.key === "Escape" && panelOpen) setPanelOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [panelOpen]);

  const ask = useCallback(
    async (question: string) => {
      const body = question.trim();
      if (!body || busy) return;
      setBusy(true);
      setError(null);
      setIntakeReceipt(null);
      try {
        const response = await fetch(`/api/v1/projects/${projectId}/ask`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ body, ...(conversationId ? { conversationId } : {}) }),
        });
        const payload = (await response.json().catch(() => null)) as {
          conversationId?: string;
          runId?: string;
          error?: { message?: string };
        } | null;
        if (!response.ok || !payload?.runId || !payload.conversationId) {
          throw new Error(payload?.error?.message ?? `ask failed (${response.status})`);
        }
        setConversationId(payload.conversationId);
        try {
          sessionStorage.setItem(storageKey, payload.conversationId);
        } catch {
          // Best-effort thread persistence.
        }
        setActiveRunId(payload.runId);
        setPendingQuestion(body);
        setPanelOpen(true);
        setValue("");
        setPendingPaste(null);
      } catch (askError) {
        setError(askError instanceof Error ? askError.message : "ask failed");
      } finally {
        setBusy(false);
      }
    },
    [busy, conversationId, projectId, storageKey],
  );

  async function fileAsSignal(content: string) {
    setBusy(true);
    setError(null);
    try {
      const title = content
        .split("\n")
        .map((line) => line.trim())
        .find(Boolean)
        ?.slice(0, 80);
      const response = await fetch(`/api/v1/projects/${projectId}/kb/intake`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: title || "Pasted material",
          source: "pasted via ask bar",
          bodyMd: content,
          dispatch: true,
        }),
      });
      const payload = (await response.json().catch(() => null)) as {
        artifactId?: string;
        runId?: string | null;
        error?: { message?: string };
      } | null;
      if (!response.ok || !payload?.artifactId) {
        throw new Error(payload?.error?.message ?? `intake failed (${response.status})`);
      }
      setIntakeReceipt({ artifactId: payload.artifactId, runId: payload.runId ?? null });
      setPendingPaste(null);
      setValue("");
    } catch (intakeError) {
      setError(intakeError instanceof Error ? intakeError.message : "intake failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-4">
      <div className="pointer-events-auto flex w-full max-w-2xl flex-col gap-2">
        {panelOpen ? (
          <AskPanel
            projectId={projectId}
            conversationId={conversationId}
            activeRunId={activeRunId}
            pendingQuestion={pendingQuestion}
            onClose={() => setPanelOpen(false)}
          />
        ) : null}
        {pendingPaste ? (
          <div className="flex flex-wrap items-center gap-2 border border-(--line) bg-(--bg) px-3 py-2">
            <span className="font-mono text-[11px] text-(--dim)">
              {pendingPaste.length.toLocaleString()} chars pasted —
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void fileAsSignal(pendingPaste)}
            >
              file as signal + backlog review
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void ask(pendingPaste)}
            >
              ask about it
            </Button>
            <Button size="sm" variant="outline" onClick={() => setPendingPaste(null)}>
              dismiss
            </Button>
          </div>
        ) : null}
        {intakeReceipt ? (
          <div className="flex flex-wrap items-center gap-2 border border-(--line) bg-(--bg) px-3 py-2 font-mono text-[11px] text-(--mut)">
            filed as <span className="text-(--ink)">{intakeReceipt.artifactId}</span>
            {intakeReceipt.runId ? (
              <a
                href={`/projects/${projectId}/sessions/${intakeReceipt.runId}`}
                className="text-(--info,--mut) underline-offset-2 hover:underline"
              >
                backlog review run ↗
              </a>
            ) : null}
            <button
              type="button"
              className="ml-auto text-(--dim) hover:text-(--ink)"
              onClick={() => setIntakeReceipt(null)}
            >
              ×
            </button>
          </div>
        ) : null}
        {error ? (
          <p className="border border-(--line) bg-(--bg) px-3 py-2 font-mono text-[11px] text-(--bad,--mut)">
            {error}
          </p>
        ) : null}
        <form
          className="flex items-center gap-2 border border-(--line) bg-(--bg) px-3 py-2 shadow-[0_8px_30px_rgba(0,0,0,0.35)]"
          onSubmit={(event) => {
            event.preventDefault();
            void ask(value);
          }}
        >
          <span aria-hidden className="font-mono text-[12px] text-(--accent)">
            ▸
          </span>
          <input
            ref={inputRef}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onFocus={() => {
              if (conversationId || activeRunId) setPanelOpen(true);
            }}
            onPaste={(event) => {
              const pasted = event.clipboardData.getData("text");
              if (pasted.length > PASTE_INTAKE_CHARS) {
                event.preventDefault();
                setPendingPaste(pasted);
              }
            }}
            placeholder="ask the product owner — or paste a transcript ( / to focus )"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-(--ink) outline-none placeholder:text-(--dim)"
          />
          <Button size="sm" variant="outline" type="submit" disabled={busy || !value.trim()}>
            {busy ? "…" : "ask"}
          </Button>
        </form>
      </div>
    </div>
  );
}
