import type { JSX } from "react";

/**
 * A small, dependency-free markdown renderer for KB and harness content —
 * enough structure (headings, lists, GFM pipe tables, task-list glyphs, code,
 * quotes, bold/italic/code spans, links, artifact references) to read a
 * document like a wiki, without pulling a parser into the bundle. Everything
 * is escaped by React; no raw HTML is ever injected.
 *
 * Non-goals (deliberate): nested lists, images, raw HTML.
 *
 * Keys come from a monotonic counter, not array indices: the source is parsed
 * wholesale on every render into a fixed token sequence that never reorders, so
 * a per-render running id is both unique and stable enough for React here.
 */

/**
 * Optional resolver for artifact references (`[[D001]]` wikilinks and bare
 * `D001`-style ids). Return an href to link the id, or null to render it as
 * plain mono text (dangling reference). When undefined, references render
 * exactly as before — other consumers stay byte-identical.
 */
export type LinkArtifact = (id: string) => string | null;

const ARTIFACT_TOKEN_RE = /(\[\[[^\]]+\]\]|\b(?:S|D|T|V|R|H|E|F|L|CR|SR)\d{3}\b)/g;
const WIKILINK_RE = /^\[\[([^\]|#]+)(?:[|#]([^\]]*))?\]\]$/;
const BARE_ID_RE = /^(?:S|D|T|V|R|H|E|F|L|CR|SR)\d{3}$/;

function renderInline(
  text: string,
  key: string,
  linkArtifact?: LinkArtifact,
): (string | JSX.Element)[] {
  // Order matters: code spans first (their contents are literal), then
  // artifact references, then links, then bold, then italic.
  const nodes: (string | JSX.Element)[] = [];
  let n = 0;
  for (const chunk of text.split(/(`[^`]+`)/g)) {
    if (/^`[^`]+`$/.test(chunk)) {
      nodes.push(
        <code
          key={`${key}-c${n++}`}
          className="rounded-[2px] bg-(--card) px-1 py-0.5 font-mono text-[0.92em] text-(--code)"
        >
          {chunk.slice(1, -1)}
        </code>,
      );
      continue;
    }
    nodes.push(...renderArtifacts(chunk, `${key}-c${n++}`, linkArtifact));
  }
  return nodes;
}

function renderArtifacts(
  text: string,
  key: string,
  linkArtifact?: LinkArtifact,
): (string | JSX.Element)[] {
  if (!linkArtifact) return renderLinks(text, key, linkArtifact);
  const out: (string | JSX.Element)[] = [];
  let n = 0;
  for (const part of text.split(ARTIFACT_TOKEN_RE)) {
    const wiki = part.match(WIKILINK_RE);
    const id = wiki?.[1]?.trim() ?? (BARE_ID_RE.test(part) ? part : null);
    if (id) {
      const label = wiki?.[2]?.trim() || id;
      const href = linkArtifact(id);
      out.push(
        href ? (
          <a
            key={`${key}-a${n++}`}
            href={href}
            className="font-mono text-[0.92em] text-(--info) underline underline-offset-4"
          >
            {label}
          </a>
        ) : (
          <span key={`${key}-a${n++}`} className="font-mono text-[0.92em] text-(--mut)">
            {label}
          </span>
        ),
      );
      continue;
    }
    if (part) out.push(...renderLinks(part, `${key}-a${n++}`, linkArtifact));
  }
  return out;
}

function renderLinks(
  text: string,
  key: string,
  _linkArtifact?: LinkArtifact,
): (string | JSX.Element)[] {
  const out: (string | JSX.Element)[] = [];
  let n = 0;
  for (const part of text.split(/(\[[^\]]+\]\((?:https?:\/\/|\/)[^)]+\))/g)) {
    const match = part.match(/^\[([^\]]+)\]\(((?:https?:\/\/|\/)[^)]+)\)$/);
    if (match?.[1] && match[2]) {
      out.push(
        <a
          key={`${key}-l${n++}`}
          href={match[2]}
          target={match[2].startsWith("http") ? "_blank" : undefined}
          rel="noreferrer"
          className="text-(--info) underline underline-offset-4"
        >
          {match[1]}
        </a>,
      );
      continue;
    }
    out.push(...renderEmphasis(part, `${key}-l${n++}`));
  }
  return out;
}

function renderEmphasis(text: string, key: string): (string | JSX.Element)[] {
  const out: (string | JSX.Element)[] = [];
  let n = 0;
  for (const part of text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|_[^_]+_)/g)) {
    if (/^\*\*[^*]+\*\*$/.test(part)) {
      out.push(
        <strong key={`${key}-b${n++}`} className="font-semibold text-(--ink)">
          {part.slice(2, -2)}
        </strong>,
      );
    } else if (/^\*[^*]+\*$/.test(part) || /^_[^_]+_$/.test(part)) {
      out.push(
        <em key={`${key}-i${n++}`} className="italic">
          {part.slice(1, -1)}
        </em>,
      );
    } else if (part) {
      out.push(part);
    }
  }
  return out;
}

const TASK_RE = /^\[([ xX])\]\s+(.*)$/;

function isTableSeparator(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) return false;
  const cells = splitRow(trimmed);
  return cells.length > 0 && cells.every((cell) => /^:?-{2,}:?$/.test(cell.trim()));
}

function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

export function Markdown({
  source,
  linkArtifact,
}: {
  source: string;
  linkArtifact?: LinkArtifact;
}) {
  const lines = source.replaceAll("\r\n", "\n").split("\n");
  const blocks: JSX.Element[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let code: string[] | null = null;

  const flushList = () => {
    if (!list) return;
    let n = 0;
    const items = list.items.map((item) => {
      const key = `li-${blocks.length}-${n++}`;
      const task = item.match(TASK_RE);
      if (task?.[2] !== undefined) {
        const done = task[1] !== " ";
        return (
          <li key={key} className="list-none leading-relaxed">
            <span aria-hidden className="mr-1.5 font-mono text-[0.92em] text-(--dim)">
              {done ? "☑" : "☐"}
            </span>
            <span className={done ? "text-(--dim) line-through" : undefined}>
              {renderInline(task[2], key, linkArtifact)}
            </span>
          </li>
        );
      }
      return (
        <li key={key} className="leading-relaxed">
          {renderInline(item, key, linkArtifact)}
        </li>
      );
    });
    blocks.push(
      list.ordered ? (
        <ol key={`ol-${blocks.length}`} className="ml-5 list-decimal space-y-1 text-(--mut)">
          {items}
        </ol>
      ) : (
        <ul key={`ul-${blocks.length}`} className="ml-5 list-disc space-y-1 text-(--mut)">
          {items}
        </ul>
      ),
    );
    list = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    if (raw.trim().startsWith("```")) {
      if (code) {
        blocks.push(
          <pre
            key={`pre-${blocks.length}`}
            className="overflow-auto border border-(--line) bg-(--card) p-3 font-mono text-[12px] text-(--mut)"
          >
            {code.join("\n")}
          </pre>,
        );
        code = null;
      } else {
        flushList();
        code = [];
      }
      continue;
    }
    if (code) {
      code.push(raw);
      continue;
    }

    // GFM pipe table: a header row followed by a separator row.
    if (raw.trim().startsWith("|") && isTableSeparator(lines[i + 1] ?? "")) {
      flushList();
      const header = splitRow(raw);
      const rows: string[][] = [];
      let j = i + 2;
      while (j < lines.length && (lines[j] ?? "").trim().startsWith("|")) {
        rows.push(splitRow(lines[j] ?? ""));
        j++;
      }
      const tkey = `t-${blocks.length}`;
      blocks.push(
        <div key={tkey} className="overflow-x-auto">
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr>
                {header.map((cell, c) => (
                  <th
                    // biome-ignore lint/suspicious/noArrayIndexKey: static parse, columns never reorder
                    key={`${tkey}-h${c}`}
                    className="border border-(--line) bg-(--card) px-3 py-1.5 text-left font-mono text-[11px] font-medium text-(--ink)"
                  >
                    {renderInline(cell, `${tkey}-h${c}`, linkArtifact)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((cells, r) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: static parse, rows never reorder
                <tr key={`${tkey}-r${r}`}>
                  {header.map((_, c) => (
                    <td
                      // biome-ignore lint/suspicious/noArrayIndexKey: static parse, columns never reorder
                      key={`${tkey}-r${r}c${c}`}
                      className="border border-(--line) px-3 py-1.5 align-top text-(--mut)"
                    >
                      {renderInline(cells[c] ?? "", `${tkey}-r${r}c${c}`, linkArtifact)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      i = j - 1;
      continue;
    }

    const heading = raw.match(/^(#{1,4})\s+(.*)$/);
    if (heading?.[2]) {
      flushList();
      const level = heading[1]?.length ?? 1;
      const size = level === 1 ? "text-[17px]" : level === 2 ? "text-[15px]" : "text-[13.5px]";
      const cls = `mt-2 font-semibold tracking-tight text-(--ink) ${size}`;
      const content = renderInline(heading[2], `h-${blocks.length}`, linkArtifact);
      const key = `h-${blocks.length}`;
      blocks.push(
        level === 1 ? (
          <h1 key={key} className={cls}>
            {content}
          </h1>
        ) : level === 2 ? (
          <h2 key={key} className={cls}>
            {content}
          </h2>
        ) : level === 3 ? (
          <h3 key={key} className={cls}>
            {content}
          </h3>
        ) : (
          <h4 key={key} className={cls}>
            {content}
          </h4>
        ),
      );
      continue;
    }

    const ordered = raw.match(/^\s*\d+\.\s+(.*)$/);
    const bullet = raw.match(/^\s*[-*]\s+(.*)$/);
    if (ordered?.[1] !== undefined) {
      if (!list?.ordered) {
        flushList();
        list = { ordered: true, items: [] };
      }
      list.items.push(ordered[1]);
      continue;
    }
    if (bullet?.[1] !== undefined) {
      if (list?.ordered) flushList();
      if (!list) list = { ordered: false, items: [] };
      list.items.push(bullet[1]);
      continue;
    }

    if (raw.trim().startsWith(">")) {
      flushList();
      blocks.push(
        <blockquote
          key={`q-${blocks.length}`}
          className="border-l-2 border-(--line-strong) pl-3 text-(--mut) italic"
        >
          {renderInline(raw.replace(/^\s*>\s?/, ""), `q-${blocks.length}`, linkArtifact)}
        </blockquote>,
      );
      continue;
    }

    if (raw.trim() === "") {
      flushList();
      continue;
    }

    flushList();
    blocks.push(
      <p key={`p-${blocks.length}`} className="leading-relaxed text-(--mut)">
        {renderInline(raw, `p-${blocks.length}`, linkArtifact)}
      </p>,
    );
  }
  flushList();
  if (code) {
    blocks.push(
      <pre
        key={`pre-${blocks.length}`}
        className="overflow-auto border border-(--line) bg-(--card) p-3 font-mono text-[12px] text-(--mut)"
      >
        {code.join("\n")}
      </pre>,
    );
  }

  return <div className="flex flex-col gap-2 text-[13px]">{blocks}</div>;
}
