"use client";

import { Button, StatusDot } from "@facility/ui";
import { useEffect, useState } from "react";
import { useAskStream } from "@/components/ask/use-ask-stream";
import { Markdown } from "@/components/markdown";

type ThreadMessage = { id: string; role: string; body: string };

/**
 * A stored Product Owner conversation: full history plus follow-up with the
 * thread's context intact (same /ask endpoint, pinned conversationId).
 */
export function ThreadView({
  projectId,
  conversationId,
  title,
}: {
  projectId: string;
  conversationId: string;
  title: string | null;
}) {
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const turn = useAskStream(activeRunId);

  // turn.final is the refetch trigger: the durable reply replaces the stream.
  // biome-ignore lint/correctness/useExhaustiveDependencies: turn.final is the intended change-trigger.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`/api/v1/conversations/${conversationId}`, {
          cache: "no-store",
        });
        if (!response.ok) return;
        const detail = (await response.json()) as { messages?: ThreadMessage[] };
        if (!cancelled) setMessages(detail.messages ?? []);
      } catch {
        // Best-effort; the live turn still renders.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [conversationId, turn.final]);

  async function followUp() {
    const body = value.trim();
    if (!body || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/projects/${projectId}/ask`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body, conversationId }),
      });
      const payload = (await response.json().catch(() => null)) as {
        runId?: string;
        error?: { message?: string };
      } | null;
      if (!response.ok || !payload?.runId) {
        throw new Error(payload?.error?.message ?? `ask failed (${response.status})`);
      }
      setActiveRunId(payload.runId);
      setPending(body);
      setValue("");
    } catch (askError) {
      setError(askError instanceof Error ? askError.message : "ask failed");
    } finally {
      setBusy(false);
    }
  }

  const lastUserBody = [...messages]
    .reverse()
    .find((message) => message.role === "user")
    ?.body?.trim();
  const liveEcho = pending && !turn.final && lastUserBody !== pending.trim();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 border border-(--line) bg-(--card) px-4 py-2.5">
        <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-(--dim)">
          conversation
        </span>
        <span className="truncate text-[12.5px] text-(--mut)">{title ?? conversationId}</span>
      </div>
      <div className="flex flex-col gap-4">
        {messages.map((message) => (
          <div key={message.id} className={message.role === "user" ? "self-end" : "self-start"}>
            {message.role === "user" ? (
              <p className="max-w-[52ch] border border-(--line) bg-(--card) px-3 py-2 text-[13px] leading-relaxed text-(--ink)">
                {message.body}
              </p>
            ) : (
              <div className="max-w-none text-[13px]">
                <Markdown source={message.body} />
              </div>
            )}
          </div>
        ))}
        {liveEcho ? (
          <div className="self-end">
            <p className="max-w-[52ch] border border-(--line) bg-(--card) px-3 py-2 text-[13px] leading-relaxed text-(--ink)">
              {pending}
            </p>
          </div>
        ) : null}
        {activeRunId && !turn.final ? (
          <div className="flex flex-col gap-2 self-start">
            {turn.status || !turn.text ? (
              <p className="flex items-center gap-2 font-mono text-[11px] text-(--dim)">
                <StatusDot tone="agent" pulse />
                {turn.status ?? "thinking…"}
              </p>
            ) : null}
            {turn.text ? (
              <div className="max-w-none text-[13px]">
                <Markdown source={turn.text} />
              </div>
            ) : null}
          </div>
        ) : null}
        {turn.error ? (
          <p className="flex items-center gap-2 self-start font-mono text-[11.5px] text-(--bad,--mut)">
            <StatusDot tone="bad" />
            {turn.error}
          </p>
        ) : null}
        {error ? <p className="font-mono text-[11px] text-(--bad,--mut)">{error}</p> : null}
      </div>
      <form
        className="flex items-center gap-2 border border-(--line) bg-(--bg) px-3 py-2"
        onSubmit={(event) => {
          event.preventDefault();
          void followUp();
        }}
      >
        <input
          type="text"
          name="facility-thread-follow-up"
          autoComplete="off"
          data-1p-ignore="true"
          data-lpignore="true"
          data-form-type="other"
          aria-label="Follow up in this conversation"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="follow up — same thread, context intact"
          className="min-w-0 flex-1 bg-transparent text-[13px] text-(--ink) outline-none placeholder:text-(--dim)"
        />
        <Button size="sm" variant="outline" type="submit" disabled={busy || !value.trim()}>
          {busy ? "…" : "send"}
        </Button>
      </form>
    </div>
  );
}
