"use client";

import "@milkdown/kit/prose/view/style/prosemirror.css";
import "@milkdown/kit/prose/tables/style/tables.css";

import { Button } from "@facility/ui";
import { defaultValueCtx, Editor, rootCtx } from "@milkdown/kit/core";
import { listener, listenerCtx } from "@milkdown/kit/plugin/listener";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import { Milkdown, MilkdownProvider, useEditor } from "@milkdown/react";
import { useRef } from "react";

/**
 * The Product tab's markdown editor: Milkdown (commonmark + GFM), headless,
 * themed to the hairline/mono design language via the wrapper selectors
 * below. Mounted only while editing — read views keep the bespoke renderer.
 * Value in/out is a plain markdown string (frontmatter handling is the
 * caller's job — see lib/kb.ts splitFrontmatter).
 */

function EditorSurface({ initial, onChange }: { initial: string; onChange: (md: string) => void }) {
  useEditor(
    (root) =>
      Editor.make()
        .config((ctx) => {
          ctx.set(rootCtx, root);
          ctx.set(defaultValueCtx, initial);
          ctx.get(listenerCtx).markdownUpdated((_ctx, md) => onChange(md));
        })
        .use(commonmark)
        .use(gfm)
        .use(listener),
    [initial],
  );
  return <Milkdown />;
}

export function MarkdownEditor({
  initial,
  saveLabel = "save",
  busy = false,
  note,
  hint,
  onSave,
  onCancel,
}: {
  initial: string;
  saveLabel?: string;
  busy?: boolean;
  /** Error/status line rendered next to the actions. */
  note?: string | null;
  /** Quiet contextual hint (e.g. "decisions are immutable — this creates a successor"). */
  hint?: string;
  onSave: (markdown: string) => void;
  onCancel: () => void;
}) {
  // The listener fires on every doc change; a ref avoids re-rendering the
  // whole editor per keystroke. Falls back to the initial value untouched.
  const current = useRef(initial);

  return (
    <div className="flex flex-col gap-3">
      <div
        className={[
          "border border-(--line) bg-(--bg-subtle)",
          // Headless ProseMirror theming: match the reader's type scale.
          "[&_.ProseMirror]:min-h-[320px] [&_.ProseMirror]:p-4 [&_.ProseMirror]:text-[13px]",
          "[&_.ProseMirror]:leading-relaxed [&_.ProseMirror]:text-(--ink) [&_.ProseMirror]:outline-none",
          "[&_.ProseMirror_h1]:text-[17px] [&_.ProseMirror_h2]:text-[15px] [&_.ProseMirror_h3]:text-[13.5px]",
          "[&_.ProseMirror_h1]:font-semibold [&_.ProseMirror_h2]:font-semibold [&_.ProseMirror_h3]:font-semibold",
          "[&_.ProseMirror_code]:bg-(--card) [&_.ProseMirror_code]:font-mono [&_.ProseMirror_code]:text-[0.92em]",
          "[&_.ProseMirror_pre]:border [&_.ProseMirror_pre]:border-(--line) [&_.ProseMirror_pre]:bg-(--card) [&_.ProseMirror_pre]:p-3",
          "[&_.ProseMirror_blockquote]:border-l-2 [&_.ProseMirror_blockquote]:border-(--line-strong) [&_.ProseMirror_blockquote]:pl-3",
          "[&_.ProseMirror_a]:text-(--info) [&_.ProseMirror_a]:underline",
          "[&_.ProseMirror_table]:border-collapse [&_.ProseMirror_td]:border [&_.ProseMirror_td]:border-(--line) [&_.ProseMirror_td]:px-2 [&_.ProseMirror_th]:border [&_.ProseMirror_th]:border-(--line) [&_.ProseMirror_th]:bg-(--card) [&_.ProseMirror_th]:px-2",
        ].join(" ")}
      >
        <MilkdownProvider>
          <EditorSurface
            initial={initial}
            onChange={(md) => {
              current.current = md;
            }}
          />
        </MilkdownProvider>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          variant="primary"
          tone="agent"
          disabled={busy}
          onClick={() => onSave(current.current)}
        >
          {busy ? "saving…" : saveLabel}
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={onCancel}>
          cancel
        </Button>
        {hint ? <span className="font-mono text-[10px] text-(--dim)">{hint}</span> : null}
        {note ? <span className="font-mono text-[11px] text-(--bad)">{note}</span> : null}
      </div>
    </div>
  );
}
