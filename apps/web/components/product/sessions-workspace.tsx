"use client";

import { Button, cx } from "@facility/ui";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";
import { AskComposer } from "@/components/ask/ask-composer";
import { ThreadMessages } from "@/components/ask/thread-messages";

export type SessionThread = { id: string; title: string | null; updatedAt?: string };

/**
 * The Sessions workspace: thread list on the left, the open conversation on
 * the right, the shared composer below — the Claude Desktop shape. The
 * composer is the exact component the floating bar hosts.
 */
export function SessionsWorkspace({
  projectId,
  threads,
}: {
  projectId: string;
  threads: SessionThread[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selected = searchParams.get("session");
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  const select = useCallback(
    (id: string | null) => {
      setActiveRunId(null);
      setPending(null);
      router.replace(id ? `?session=${encodeURIComponent(id)}` : "?", { scroll: false });
    },
    [router],
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
      <nav aria-label="Chat sessions" className="flex flex-col gap-2">
        <Button size="sm" variant="outline" onClick={() => select(null)}>
          new session
        </Button>
        <div className="flex flex-col">
          {threads.length === 0 ? (
            <p className="px-2 py-1.5 text-[11.5px] italic text-(--dim)">
              no sessions yet — start one below
            </p>
          ) : (
            threads.map((thread) => (
              <button
                key={thread.id}
                type="button"
                onClick={() => select(thread.id)}
                title={thread.title ?? thread.id}
                className={cx(
                  "px-2 py-1.5 text-left text-[12.5px] hover:text-(--ink)",
                  selected === thread.id ? "font-medium text-(--ink)" : "text-(--mut)",
                )}
              >
                <span className="block min-w-0 truncate">{thread.title ?? "untitled session"}</span>
              </button>
            ))
          )}
        </div>
      </nav>

      <div className="flex min-h-[50vh] flex-col gap-4">
        <div className="flex-1">
          <ThreadMessages
            conversationId={selected}
            activeRunId={activeRunId}
            pending={pending}
            emptyHint={
              selected
                ? undefined
                : "A fresh session — ask anything about this project, or paste a transcript to file it and review the backlog."
            }
          />
        </div>
        <AskComposer
          projectId={projectId}
          conversationId={selected}
          onTurnStarted={({ conversationId, runId, question }) => {
            setActiveRunId(runId);
            setPending(question);
            if (selected !== conversationId) {
              router.replace(`?session=${encodeURIComponent(conversationId)}`, { scroll: false });
            }
            // New threads appear in the server-rendered list on refresh.
            router.refresh();
          }}
        />
      </div>
    </div>
  );
}
