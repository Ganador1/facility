"use client";

import { useEffect, useState } from "react";

export type AskToolChip = {
  /** Stable append-order id — chips are append-only, never reordered. */
  id: number;
  tool: string;
  ok?: boolean;
  ms?: number;
  /** consult_architect / intake_capture surface the dispatched run. */
  runId?: string;
  artifactId?: string;
};

export type AskTurnState = {
  status: string | null;
  tools: AskToolChip[];
  text: string;
  final: boolean;
  error: string | null;
};

const INITIAL: AskTurnState = { status: null, tools: [], text: "", final: false, error: null };

/**
 * Thin consumer of the run-events SSE channel for one assistant turn.
 * Durable + resumable server-side; this reducer only shapes the UI state.
 */
export function useAskStream(runId: string | null): AskTurnState {
  const [state, setState] = useState<AskTurnState>(INITIAL);

  useEffect(() => {
    if (!runId) {
      setState(INITIAL);
      return;
    }
    setState(INITIAL);
    const source = new EventSource(`/api/v1/runs/${runId}/stream?afterSeq=0`);
    source.addEventListener("run_event", (message) => {
      let event: { type?: string; data?: Record<string, unknown> };
      try {
        event = JSON.parse((message as MessageEvent).data);
      } catch {
        return;
      }
      const data = event.data ?? {};
      setState((prev) => {
        switch (event.type) {
          case "status":
            return { ...prev, status: typeof data.message === "string" ? data.message : null };
          case "assistant_delta":
            return {
              ...prev,
              status: null,
              text: prev.text + (typeof data.text === "string" ? data.text : ""),
            };
          case "tool_call":
            return {
              ...prev,
              status: null,
              tools: [...prev.tools, { id: prev.tools.length, tool: String(data.tool ?? "tool") }],
            };
          case "tool_result": {
            const tools = [...prev.tools];
            for (let i = tools.length - 1; i >= 0; i--) {
              const chip = tools[i];
              if (chip && chip.tool === data.tool && chip.ok === undefined) {
                tools[i] = {
                  ...chip,
                  ok: data.ok !== false,
                  ms: typeof data.ms === "number" ? data.ms : undefined,
                  runId: typeof data.runId === "string" ? data.runId : undefined,
                  artifactId: typeof data.artifactId === "string" ? data.artifactId : undefined,
                };
                break;
              }
            }
            return { ...prev, tools };
          }
          case "assistant":
            return { ...prev, text: typeof data.text === "string" ? data.text : prev.text };
          case "result":
            return {
              ...prev,
              final: true,
              status: null,
              error:
                data.status === "succeeded"
                  ? null
                  : typeof data.error === "string"
                    ? data.error
                    : "turn failed",
            };
          default:
            return prev;
        }
      });
    });
    source.onerror = () => {
      // The endpoint resumes via afterSeq; EventSource reconnects on its own.
    };
    return () => source.close();
  }, [runId]);

  useEffect(() => {
    // Nothing extra: closing happens on unmount/runId change; final turns keep
    // their state rendered.
  }, []);

  return state;
}
