"use client";

import "@milkdown/crepe/theme/common/style.css";
import "./crepe-theme.css";

import { Crepe } from "@milkdown/crepe";
import { useEffect, useRef } from "react";

/**
 * The always-on WYSIWYG surface (Milkdown Crepe). Markdown stays the source
 * of truth — humans edit the exact text agents read and write — and there is
 * no edit mode: like Notion, the page IS the editor. The host owns saving.
 */
export function CrepeEditor({
  docKey,
  value,
  readOnly = false,
  placeholder,
  onMarkdownChange,
  onNavigateRef,
}: {
  /** Document identity — the editor recreates itself when it changes. */
  docKey: string;
  /** Initial markdown; the editor owns the document afterwards. */
  value: string;
  readOnly?: boolean;
  placeholder?: string;
  onMarkdownChange?: (md: string) => void;
  /** Cmd/Ctrl+click on an artifact ref (D001, [[R002]], [[CHARTER]]…) navigates. */
  onNavigateRef?: (artifactId: string) => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const crepeRef = useRef<Crepe | null>(null);
  const changeRef = useRef(onMarkdownChange);
  changeRef.current = onMarkdownChange;
  const navRef = useRef(onNavigateRef);
  navRef.current = onNavigateRef;
  const initialReadOnly = useRef(readOnly);
  initialReadOnly.current = readOnly;
  const initialValue = useRef(value);
  initialValue.current = value;
  const initialPlaceholder = useRef(placeholder);
  initialPlaceholder.current = placeholder;

  // biome-ignore lint/correctness/useExhaustiveDependencies: docKey is the recreate trigger; value/placeholder/readOnly are initial-only via refs.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const crepe = new Crepe({
      root,
      defaultValue: initialValue.current,
      features: {
        [Crepe.Feature.ImageBlock]: false,
        [Crepe.Feature.Latex]: false,
      },
      featureConfigs: {
        [Crepe.Feature.Placeholder]: {
          text: initialPlaceholder.current ?? "write…",
        },
      },
    });
    crepe.on((listener) => {
      listener.markdownUpdated((_ctx, md) => changeRef.current?.(md));
    });
    crepe.setReadonly(initialReadOnly.current);
    crepeRef.current = crepe;
    const created = crepe.create();
    return () => {
      crepeRef.current = null;
      void created.then(() => crepe.destroy());
    };
  }, [docKey]);

  useEffect(() => {
    crepeRef.current?.setReadonly(readOnly);
  }, [readOnly]);

  return (
    <div
      ref={rootRef}
      onClickCapture={(event) => {
        if (!navRef.current || !(event.metaKey || event.ctrlKey)) return;
        const ref = artifactRefAtPoint(event.clientX, event.clientY);
        if (ref) {
          event.preventDefault();
          event.stopPropagation();
          navRef.current(ref);
        }
      }}
      className="facility-crepe h-full min-h-0"
    />
  );
}

const REF_RE = /\[\[([A-Z]{1,2}\d{3}|CHARTER|ACTIVE)\]\]|([A-Z]{1,2}\d{3})/g;

/** Resolve the artifact ref under a pointer position, if any. */
function artifactRefAtPoint(x: number, y: number): string | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  let node: Node | null = null;
  let offset = 0;
  const pos = doc.caretPositionFromPoint?.(x, y);
  if (pos) {
    node = pos.offsetNode;
    offset = pos.offset;
  } else {
    const range = doc.caretRangeFromPoint?.(x, y);
    if (range) {
      node = range.startContainer;
      offset = range.startOffset;
    }
  }
  if (!node || node.nodeType !== Node.TEXT_NODE) return null;
  const text = node.textContent ?? "";
  for (const match of text.matchAll(REF_RE)) {
    const start = match.index ?? 0;
    if (offset >= start && offset <= start + match[0].length) {
      return match[1] ?? match[2] ?? null;
    }
  }
  return null;
}
