import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";

const REF_RE = /\[\[([A-Z]{1,2}\d{3}|CHARTER|ACTIVE)\]\]|\b([A-Z]{1,2}\d{3})\b/g;
const CODE_NODES = new Set(["code_block", "codeBlock"]);
const CODE_MARKS = new Set(["inlineCode", "code_inline", "code"]);

function decorate(doc: ProseNode): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos, parent) => {
    if (parent && CODE_NODES.has(parent.type.name)) return;
    if (!node.isText) return;
    if (node.marks.some((mark) => CODE_MARKS.has(mark.type.name))) return;
    const text = node.text ?? "";
    for (const match of text.matchAll(REF_RE)) {
      const ref = match[1] ?? match[2];
      if (!ref) continue;
      const from = pos + (match.index ?? 0);
      decorations.push(
        Decoration.inline(from, from + match[0].length, {
          class: "artifact-ref",
          "data-ref": ref,
          title: `open ${ref}`,
        }),
      );
    }
  });
  return DecorationSet.create(doc, decorations);
}

/**
 * Artifact refs (D001, [[R002]], [[CHARTER]]) rendered as live links inside
 * the editor: decorated and clickable, while the markdown stays plain text —
 * agents read exactly what humans see.
 */
export function artifactRefs(getNavigate: () => ((ref: string) => void) | undefined) {
  return $prose(
    () =>
      new Plugin({
        key: new PluginKey("facility-artifact-refs"),
        state: {
          init: (_config, state) => decorate(state.doc),
          apply: (tr, decorations, _old, state) =>
            tr.docChanged ? decorate(state.doc) : decorations,
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
          handleClick(_view, _pos, event) {
            const ref = (event.target as HTMLElement | null)
              ?.closest?.(".artifact-ref")
              ?.getAttribute("data-ref");
            const navigate = getNavigate();
            if (ref && navigate) {
              navigate(ref);
              return true;
            }
            return false;
          },
        },
      }),
  );
}
