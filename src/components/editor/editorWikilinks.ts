import {
  autocompletion,
  closeCompletion,
  completionKeymap,
  type Completion,
  type CompletionContext,
} from "@codemirror/autocomplete";
import { EditorSelection, Prec, type Extension, RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  keymap,
  type DecorationSet,
  type ViewUpdate,
  ViewPlugin,
} from "@codemirror/view";
import type { MemoryOntology } from "../../lib/types";
import {
  getActivePreviewLineNumbers,
  shouldRefreshActivePreviewLines,
} from "./editorPreviewState";

const WIKILINK_RE = /\[\[([^\[\]\n]+?)\]\]/g;
const MAX_EMPTY_QUERY_SUGGESTIONS = 12;
const MAX_RECOMMENDED_SUGGESTIONS = 8;

export interface WikilinkTarget {
  id: string;
  l0: string;
  ontology: MemoryOntology;
  folderCategory: string | null;
}

export interface WikilinkDraftMemory {
  id: string;
  l0: string;
}

interface WikilinkResolvedMatch {
  kind: "exact_id" | "exact_l0" | "fuzzy_l0";
  target: WikilinkTarget;
}

interface WikilinkAmbiguousMatch {
  kind: "ambiguous";
  candidates: WikilinkTarget[];
}

interface WikilinkUnresolvedMatch {
  kind: "unresolved";
}

type WikilinkMatchResult =
  | WikilinkResolvedMatch
  | WikilinkAmbiguousMatch
  | WikilinkUnresolvedMatch;

interface WikilinkEditorOptions {
  targets: WikilinkTarget[];
  revealSyntaxOnActiveLine: boolean;
  onOpenMemory?: (id: string) => void;
  onCreateMemory?: (draft: WikilinkDraftMemory) => void | Promise<void>;
  getCreateMemoryLabel?: (draft: WikilinkDraftMemory) => string;
  getCreateMemoryDetail?: (draft: WikilinkDraftMemory) => string;
}

interface RankedTarget {
  target: WikilinkTarget;
  score: number;
}

function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactSearchText(value: string) {
  return normalizeSearchText(value).replace(/\s+/g, "");
}

function textTokens(value: string) {
  return normalizeSearchText(value).split(" ").filter(Boolean);
}

function isEquivalentSearchText(left: string, right: string) {
  const normalizedLeft = normalizeSearchText(left);
  const normalizedRight = normalizeSearchText(right);
  if (!normalizedLeft || !normalizedRight) {
    return false;
  }

  return (
    normalizedLeft === normalizedRight
    || compactSearchText(left) === compactSearchText(right)
  );
}

function resolveWikilinkText(text: string, targets: WikilinkTarget[]): WikilinkMatchResult {
  const trimmed = text.trim();
  if (!trimmed) {
    return { kind: "unresolved" };
  }

  const exactId = targets.find((target) => target.id === trimmed);
  if (exactId) {
    return { kind: "exact_id", target: exactId };
  }

  const exactL0 = targets.filter((target) => target.l0 === trimmed);
  if (exactL0.length === 1) {
    return { kind: "exact_l0", target: exactL0[0] };
  }
  if (exactL0.length > 1) {
    return { kind: "ambiguous", candidates: exactL0 };
  }

  const fuzzy = targets.filter(
    (target) =>
      isEquivalentSearchText(target.id, trimmed) || isEquivalentSearchText(target.l0, trimmed),
  );
  if (fuzzy.length === 1) {
    return { kind: "fuzzy_l0", target: fuzzy[0] };
  }
  if (fuzzy.length > 1) {
    return { kind: "ambiguous", candidates: fuzzy };
  }

  return { kind: "unresolved" };
}

function scoreTarget(query: string, target: WikilinkTarget): number {
  const normalizedQuery = normalizeSearchText(query);
  const compactQuery = compactSearchText(query);
  if (!normalizedQuery) {
    return 1;
  }

  const id = normalizeSearchText(target.id);
  const l0 = normalizeSearchText(target.l0);
  const compactId = compactSearchText(target.id);
  const compactL0 = compactSearchText(target.l0);
  const idTokens = textTokens(target.id);
  const l0Tokens = textTokens(target.l0);

  if (target.id === query.trim()) return 120;
  if (target.l0 === query.trim()) return 116;
  if (id === normalizedQuery) return 108;
  if (l0 === normalizedQuery) return 104;
  if (compactId === compactQuery) return 100;
  if (compactL0 === compactQuery) return 96;
  if (l0.startsWith(normalizedQuery)) return 90;
  if (id.startsWith(normalizedQuery)) return 88;
  if (l0Tokens.some((token) => token.startsWith(normalizedQuery))) return 80;
  if (idTokens.some((token) => token.startsWith(normalizedQuery))) return 78;
  if (compactL0.includes(compactQuery)) return 70;
  if (compactId.includes(compactQuery)) return 68;
  if (l0.includes(normalizedQuery)) return 62;
  if (id.includes(normalizedQuery)) return 60;
  return 0;
}

function rankTargets(query: string, targets: WikilinkTarget[]): RankedTarget[] {
  return targets
    .map((target) => ({ target, score: scoreTarget(query, target) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return (a.target.l0 || a.target.id).localeCompare(b.target.l0 || b.target.id);
    });
}

function minimumRecommendationScore(query: string) {
  const length = query.trim().length;
  if (length <= 2) return 80;
  if (length <= 4) return 60;
  return 55;
}

export function slugifyMemoryId(value: string): string {
  const ascii = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

  const slug = ascii
    .replace(/[^a-z0-9\s-_]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return slug || "untitled";
}

export function nextUniqueMemoryId(text: string, targets: ReadonlyArray<WikilinkTarget>): string {
  const base = slugifyMemoryId(text);
  const used = new Set(targets.map((target) => target.id));
  if (!used.has(base)) {
    return base;
  }

  let suffix = 2;
  while (used.has(`${base}-${suffix}`)) {
    suffix += 1;
  }
  return `${base}-${suffix}`;
}

function getWikilinkPreviewDecoration(innerText: string, resolution: WikilinkMatchResult) {
  let title: string;

  switch (resolution.kind) {
    case "exact_id":
    case "exact_l0":
    case "fuzzy_l0": {
      const target = resolution.target;
      title = [target.l0 || target.id, target.id, target.ontology, target.folderCategory]
        .filter(Boolean)
        .join(" · ");
      break;
    }
    case "ambiguous":
      title = `Multiple memories match [[${innerText.trim()}]]`;
      break;
    case "unresolved":
      title = `No memory matches [[${innerText.trim()}]]`;
      break;
  }

  return Decoration.mark({
    class: "cm-wikilink-chip",
    attributes: {
      "data-wikilink-state": resolution.kind,
      title,
    },
  });
}

const wikilinkEditorTheme = EditorView.baseTheme({
  ".cm-wikilink-chip": {
    borderRadius: "999px",
    backgroundColor: "transparent",
    cursor: "text",
    transition: "background-color 140ms ease, color 140ms ease",
  },
  ".cm-wikilink-chip[data-wikilink-state='exact_id'], .cm-wikilink-chip[data-wikilink-state='exact_l0'], .cm-wikilink-chip[data-wikilink-state='fuzzy_l0']":
    {
      color: "var(--accent)",
      backgroundColor: "color-mix(in srgb, var(--accent-muted) 72%, transparent)",
    },
  ".cm-wikilink-chip[data-wikilink-state='ambiguous']": {
    color: "var(--warning)",
    backgroundColor: "color-mix(in srgb, var(--warning) 14%, transparent)",
  },
  ".cm-wikilink-chip[data-wikilink-state='unresolved']": {
    color: "var(--danger)",
    backgroundColor: "color-mix(in srgb, var(--danger) 12%, transparent)",
  },
  ".cm-tooltip.cm-wikilink-completions": {
    border: "1px solid color-mix(in srgb, var(--border) 86%, transparent)",
    borderRadius: "16px",
    backgroundColor: "color-mix(in srgb, var(--bg-1) 96%, var(--bg-0))",
    boxShadow:
      "0 18px 48px color-mix(in srgb, black 12%, transparent), 0 2px 10px color-mix(in srgb, black 7%, transparent)",
    padding: "0.35rem",
    minWidth: "18rem",
    maxWidth: "26rem",
    overflow: "hidden",
    backdropFilter: "blur(14px)",
  },
  ".cm-tooltip.cm-wikilink-completions > ul": {
    maxHeight: "18rem",
    overflowY: "auto",
    padding: "0",
  },
  ".cm-tooltip.cm-wikilink-completions > ul > li": {
    display: "flex",
    flexDirection: "column",
    alignItems: "stretch",
    gap: "0.1rem",
    margin: "0",
    padding: "0.55rem 0.7rem",
    borderRadius: "12px",
    border: "1px solid transparent",
    color: "var(--text-0)",
  },
  ".cm-tooltip.cm-wikilink-completions > ul > li[aria-selected='true']": {
    backgroundColor: "color-mix(in srgb, var(--accent-muted) 86%, transparent)",
    borderColor: "color-mix(in srgb, var(--accent) 18%, transparent)",
  },
  ".cm-tooltip.cm-wikilink-completions .cm-completionIcon": {
    display: "none",
  },
  ".cm-tooltip.cm-wikilink-completions .cm-completionLabel": {
    display: "block",
    fontSize: "0.92rem",
    fontWeight: "620",
    lineHeight: "1.25",
    color: "var(--text-0)",
  },
  ".cm-tooltip.cm-wikilink-completions .cm-completionMatchedText": {
    textDecoration: "none",
    color: "var(--accent)",
  },
  ".cm-tooltip.cm-wikilink-completions .cm-completionDetail": {
    display: "block",
    marginLeft: "0",
    fontFamily: '"JetBrains Mono", ui-monospace, monospace',
    fontSize: "0.72rem",
    lineHeight: "1.35",
    color: "var(--text-2)",
  },
  ".cm-tooltip.cm-wikilink-completions .cm-wikilink-create-option .cm-completionLabel": {
    color: "var(--accent)",
  },
});

function createWikilinkPreviewPlugin(options: WikilinkEditorOptions) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = this.buildDecorations(view);
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = this.buildDecorations(update.view);
          return;
        }

        if (shouldRefreshActivePreviewLines(update, options.revealSyntaxOnActiveLine)) {
          this.decorations = this.buildDecorations(update.view);
        }
      }

      buildDecorations(view: EditorView) {
        const builder = new RangeSetBuilder<Decoration>();
        const activeLines = new Set(
          getActivePreviewLineNumbers(view.state, options.revealSyntaxOnActiveLine),
        );

        for (const { from, to } of view.visibleRanges) {
          const segment = view.state.sliceDoc(from, to);
          WIKILINK_RE.lastIndex = 0;

          for (let match = WIKILINK_RE.exec(segment); match; match = WIKILINK_RE.exec(segment)) {
            const matchFrom = from + match.index;
            const matchTo = matchFrom + match[0].length;
            const line = view.state.doc.lineAt(matchFrom).number;
            if (activeLines.has(line)) {
              continue;
            }

            const inner = match[1].trim();
            const resolution = resolveWikilinkText(inner, options.targets);
            builder.add(matchFrom, matchTo, getWikilinkPreviewDecoration(inner, resolution));
          }
        }

        return builder.finish();
      }
    },
    { decorations: (value) => value.decorations },
  );
}

function createWikilinkCompletionSource(options: WikilinkEditorOptions) {
  return (context: CompletionContext) => {
    const line = context.state.doc.lineAt(context.pos);
    const lineBeforeCursor = line.text.slice(0, context.pos - line.from);
    const match = lineBeforeCursor.match(/\[\[([^\]\n]*)$/);
    if (!match) {
      return null;
    }

    const query = match[1] ?? "";
    const trimmedQuery = query.trim();
    const from = context.pos - query.length - 2;
    if (!trimmedQuery && !context.explicit) {
      return null;
    }

    const ranked = rankTargets(query, options.targets)
      .filter(({ score }) =>
        !trimmedQuery || score >= minimumRecommendationScore(trimmedQuery),
      )
      .slice(0, trimmedQuery ? MAX_RECOMMENDED_SUGGESTIONS : MAX_EMPTY_QUERY_SUGGESTIONS);
    const completions: Completion[] = ranked.map(({ target, score }) => ({
      label: target.l0 || target.id,
      detail: formatCompletionDetail(target),
      type: completionTypeForOntology(target.ontology),
      boost: score,
      apply(view, _completion, applyFrom, applyTo) {
        insertWikilinkText(view, applyFrom, applyTo, target.id);
      },
    }));

    const resolution = trimmedQuery
      ? resolveWikilinkText(trimmedQuery, options.targets)
      : null;
    const shouldOfferCreate =
      trimmedQuery &&
      options.onCreateMemory &&
      (resolution === null || resolution.kind === "unresolved");

    if (shouldOfferCreate) {
      const l0 = trimmedQuery;
      const id = nextUniqueMemoryId(l0, options.targets);
      const draft = { id, l0 };
      completions.push({
        label: options.getCreateMemoryLabel?.(draft) ?? "Create new memory",
        detail: options.getCreateMemoryDetail?.(draft) ?? `${id} · unknown`,
        type: "new",
        apply(view, _completion, applyFrom, applyTo) {
          insertWikilinkText(view, applyFrom, applyTo, l0);
          closeCompletion(view);
          queueMicrotask(() => {
            void options.onCreateMemory?.({ id, l0 });
          });
        },
      });
    }

    if (completions.length === 0) {
      return null;
    }

    return {
      from,
      options: completions,
      filter: false,
      validFor: /^[^\]\n]*$/,
    };
  };
}

function insertWikilinkText(view: EditorView, from: number, to: number, value: string) {
  const text = `[[${value}]]`;
  let replaceTo = to;
  const maxReplaceTo = Math.min(view.state.doc.length, to + 2);

  while (replaceTo < maxReplaceTo && view.state.sliceDoc(replaceTo, replaceTo + 1) === "]") {
    replaceTo += 1;
  }

  view.dispatch({
    changes: { from, to: replaceTo, insert: text },
    selection: EditorSelection.cursor(from + text.length),
    scrollIntoView: true,
    userEvent: "input.complete",
  });
}

function formatCompletionDetail(target: WikilinkTarget): string {
  const parts = [
    target.l0 && target.l0 !== target.id ? target.id : null,
    target.ontology,
    target.folderCategory,
  ].filter(Boolean);

  return parts.join(" · ");
}

function completionTypeForOntology(ontology: MemoryOntology): Completion["type"] {
  switch (ontology) {
    case "source":
      return "text";
    case "entity":
      return "variable";
    case "concept":
      return "class";
    case "synthesis":
      return "function";
    case "unknown":
      return "keyword";
  }
}

export function createWikilinkExtensions(options: WikilinkEditorOptions): Extension[] {
  return [
    wikilinkEditorTheme,
    createWikilinkPreviewPlugin(options),
    autocompletion({
      override: [createWikilinkCompletionSource(options)],
      activateOnTyping: true,
      defaultKeymap: false,
      closeOnBlur: true,
      selectOnOpen: true,
      icons: false,
      tooltipClass: () => "cm-wikilink-completions",
      optionClass: (completion) =>
        completion.type === "new" ? "cm-wikilink-create-option" : "cm-wikilink-option",
    }),
    Prec.highest(keymap.of(completionKeymap)),
  ];
}
