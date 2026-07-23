"use client";

import { Button } from "@facility/ui";
import { useCallback, useRef, useState } from "react";

/** Pastes longer than this offer the intake path instead of a chat message. */
const PASTE_INTAKE_CHARS = 1_500;

type IntakeReceipt = { artifactId: string; runId: string | null };

export type TurnStart = { conversationId: string; runId: string; question: string };

/**
 * THE conversation input for the digital Product Owner — one component, used
 * verbatim by the floating bar and the Sessions workspace: same paste-to-intake
 * chips, same password-manager shielding, same /ask wiring. Only the placement
 * and what happens after a turn starts differ per host.
 */
export function AskComposer({
  projectId,
  conversationId,
  placeholder = "chat with the digital product owner",
  inputRef: externalRef,
  onTurnStarted,
}: {
  projectId: string;
  /** Pin follow-ups to a thread; null starts a fresh one on first send. */
  conversationId: string | null;
  placeholder?: string;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  onTurnStarted: (turn: TurnStart) => void;
}) {
  const [value, setValue] = useState("");
  const [pendingPaste, setPendingPaste] = useState<string | null>(null);
  const [intakeReceipt, setIntakeReceipt] = useState<IntakeReceipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const internalRef = useRef<HTMLInputElement>(null);
  const inputRef = externalRef ?? internalRef;

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
        setValue("");
        setPendingPaste(null);
        onTurnStarted({
          conversationId: payload.conversationId,
          runId: payload.runId,
          question: body,
        });
      } catch (askError) {
        setError(askError instanceof Error ? askError.message : "ask failed");
      } finally {
        setBusy(false);
      }
    },
    [busy, conversationId, projectId, onTurnStarted],
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
    <div className="flex w-full flex-col gap-2">
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
          // Plain search-style text input: the name/type plus the vendor
          // ignore attributes keep password managers (1Password, LastPass,
          // Bitwarden, browser autofill) from treating it as a credential.
          type="text"
          name="facility-ask-question"
          inputMode="text"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          data-1p-ignore="true"
          data-lpignore="true"
          data-bwignore="true"
          data-form-type="other"
          aria-label="Chat with the digital product owner"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onPaste={(event) => {
            const pasted = event.clipboardData.getData("text");
            if (pasted.length > PASTE_INTAKE_CHARS) {
              event.preventDefault();
              setPendingPaste(pasted);
            }
          }}
          placeholder={placeholder}
          className="min-w-0 flex-1 bg-transparent text-[13px] text-(--ink) outline-none placeholder:text-(--dim)"
        />
        <Button size="sm" variant="outline" type="submit" disabled={busy || !value.trim()}>
          {busy ? "…" : "send"}
        </Button>
      </form>
    </div>
  );
}
