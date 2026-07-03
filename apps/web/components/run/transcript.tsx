"use client";

import type { RunEvent } from "@/lib/api";
import { Button, Terminal, type TerminalLine, TextInput } from "@facility/ui";
import { useCallback, useEffect, useRef, useState } from "react";

function toLine(event: RunEvent): TerminalLine {
  const ts = new Date(event.ts).toLocaleTimeString("en-GB", { hour12: false });
  const text =
    typeof event.data.text === "string"
      ? event.data.text
      : typeof event.data.message === "string"
        ? event.data.message
        : JSON.stringify(event.data);
  switch (event.type) {
    case "status":
      return { tag: ts, text, tone: "info" };
    case "tool":
    case "shell":
      return { tag: ts, text, tone: "machine" };
    case "error":
      return { tag: ts, text, tone: "bad" };
    case "check":
      return { tag: ts, text, tone: event.data.result === "success" ? "ok" : "bad" };
    case "steer":
      return { tag: ts, text: `⟶ steer: ${text}`, tone: "human" };
    case "assistant":
      return { tag: ts, text, tone: "plain" };
    default:
      return { tag: ts, text: `${event.type}: ${text}`, tone: "muted" };
  }
}

/**
 * Live session view: streams run events over SSE (fallback: polling) and
 * lets an engineer steer a stuck agent. Steering is audited server-side.
 */
export function RunTranscript({
  runId,
  live,
  canSteer,
}: {
  runId: string;
  live: boolean;
  canSteer: boolean;
}) {
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [steer, setSteer] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastSeq = useRef(0);

  const pull = useCallback(async () => {
    const res = await fetch(`/api/v1/runs/${runId}/events?afterSeq=${lastSeq.current}`, {
      cache: "no-store",
    });
    if (!res.ok) return;
    const body = (await res.json()) as { items: RunEvent[] };
    if (body.items.length) {
      lastSeq.current = body.items[body.items.length - 1]?.seq ?? lastSeq.current;
      setEvents((prev) => [...prev, ...body.items]);
    }
  }, [runId]);

  useEffect(() => {
    void pull();
    if (!live) return;

    const source = new EventSource(`/api/v1/runs/${runId}/stream`);
    source.onmessage = (msg) => {
      try {
        const event = JSON.parse(msg.data) as RunEvent;
        if (event.seq > lastSeq.current) {
          lastSeq.current = event.seq;
          setEvents((prev) => [...prev, event]);
        }
      } catch {
        // heartbeat or malformed frame — ignore
      }
    };
    source.onerror = () => {
      // SSE dropped — fall back to polling until it reconnects
      void pull();
    };
    const poll = setInterval(() => {
      if (source.readyState === EventSource.CLOSED) void pull();
    }, 3000);
    return () => {
      source.close();
      clearInterval(poll);
    };
  }, [runId, live, pull]);

  async function sendSteer(e: React.FormEvent) {
    e.preventDefault();
    if (!steer.trim()) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/runs/${runId}/steer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: steer }),
      });
      if (!res.ok) throw new Error(`steer failed (${res.status})`);
      setSteer("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "steer failed");
    } finally {
      setSending(false);
    }
  }

  return (
    <Terminal
      title={live ? "live session" : "session recording"}
      lines={events.map(toLine)}
      maxHeight="max-h-[560px]"
      footer={
        canSteer && live ? (
          <form onSubmit={sendSteer} className="flex items-center gap-3">
            <TextInput
              value={steer}
              onChange={(e) => setSteer(e.target.value)}
              placeholder="Steer this session — delivered to the agent, recorded in the audit log"
              className="border-0 bg-transparent px-0"
            />
            <Button type="submit" size="sm" variant="outline" disabled={sending || !steer.trim()}>
              steer
            </Button>
            {error ? <span className="font-mono text-[11px] text-(--bad)">{error}</span> : null}
          </form>
        ) : undefined
      }
    >
      {events.length === 0 ? (
        <p className="font-mono text-[12px] text-(--dim)">
          {live ? "waiting for the first event…" : "no events recorded"}
        </p>
      ) : null}
    </Terminal>
  );
}
