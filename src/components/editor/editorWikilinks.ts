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
  WidgetType,
} from "@codemirror/view";
import type { MemoryOntology } from "../../lib/types";

const WIKILINK_RE = /\[\[([^\[\]\n]+?)\]\]/g;
const MAX_EMPTY_QUERY_SUGGESTIONS = 12;

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

  const lowered = trimmed.toLowerCase();
  const fuzzyL0 = targets.filter((target) => target.l0.toLowerCase() === lowered);
  if (fuzzyL0.length === 1) {
    return { kind: "fuzzy_l0", target: fuzzyL0[0] };
  }
  if (fuzzyL0.length > 1) {
    return { kind: "ambiguous", candidates: fuzzyL0 };
  }

  return { kind: "unresolved" };
}

function scoreTarget(query: string, target: WikilinkTarget): number {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return 1;
  }

  const id = target.id.toLowerCase();
  const l0 = target.l0.toLowerCase();

  if (id === normalized) return 100;
  if (l0 === normalized) return 95;
  if (id.startsWith(normalized)) return 85;
  if (l0.startsWith(normalized)) return 80;
  if (id.includes(normalized)) return 60;
  if (l0.includes(normalized)) return 55;
  if (isSubsequence(normalized, id)) return 30;
  if (isSubsequence(normalized, l0)) return 25;
  return 0;
}

function isSubsequence(query: string, candidate: string): boolean {
  let cursor = 0;
  for (const char of candidate) {
    if (query[cursor] === char) {
      cursor += 1;
      if (cursor === query.length) {
        return true;
      }
    }
  }
  return query.length === 0;
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

class WikilinkWidget extends WidgetType {
  constructor(
    private readonly innerText: string,
    private readonly resolution: WikilinkMatchResult,
    private readonly onOpenMemory?: (id: string) => void,
  ) {
    super();
  }

  eq(other: WikilinkWidget) {
    return (
      this.innerText === other.innerText &&
      JSON.stringify(this.resolution) === JSON.stringify(other.resolution)
    );
  }

  toDOM() {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cm-wikilink-chip";
    button.tabIndex = -1;
    button.dataset.wikilinkState = this.resolution.kind;
    button.dataset.clickable = this.isClickable ? "true" : "false";

    const label = document.createElement("span");
    label.className = "cm-wikilink-chip-label";
    label.textContent = this.label;
    button.appendChild(label);

    button.title = this.tooltip;

    if (
      (this.resolution.kind === "exact_id" ||
        this.resolution.kind === "exact_l0" ||
        this.resolution.kind === "fuzzy_l0") &&
      this.onOpenMemory
    ) {
      const targetId = this.resolution.target.id;
      const stopEditorEvent = (event: Event) => {
        event.preventDefault();
        event.stopPropagation();
      };

      button.setAttribute("aria-label", `Open ${targetId}`);
      button.addEventListener("mousedown", stopEditorEvent);
      button.addEventListener("mouseup", stopEditorEvent);
      button.addEventListener("pointerdown", stopEditorEvent);
      button.addEventListener("pointerup", stopEditorEvent);
      button.addEventListener("click", (event) => {
        stopEditorEvent(event);
        this.onOpenMemory?.(targetId);
      });
    }

    return button;
  }

  ignoreEvent(event?: Event) {
    return this.isClickable || event?.type === "dragstart";
  }

  private get isClickable() {
    return (
      (this.resolution.kind === "exact_id" ||
        this.resolution.kind === "exact_l0" ||
        this.resolution.kind === "fuzzy_l0") &&
      Boolean(this.onOpenMemory)
    );
  }

  private get label() {
    switch (this.resolution.kind) {
      case "exact_id":
      case "exact_l0":
      case "fuzzy_l0":
        return this.resolution.target.l0 || this.resolution.target.id;
      case "ambiguous":
      case "unresolved":
        return this.innerText.trim();
    }
  }

  private get tooltip() {
    switch (this.resolution.kind) {
      case "exact_id":
      case "exact_l0":
      case "fuzzy_l0": {
        const target = this.resolution.target;
        return [target.l0 || target.id, target.id, target.ontology, target.folderCategory]
          .filter(Boolean)
          .join(" · ");
      }
      case "ambiguous":
        return `Multiple memories match [[${this.innerText.trim()}]]`;
      case "unresolved":
        return `No memory matches [[${this.innerText.trim()}]]`;
    }
  }
}

const wikilinkEditorTheme = EditorView.baseTheme({
  ".cm-wikilink-chip": {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.25rem",
    maxWidth: "100%",
    padding: "0.05rem 0.42rem",
    borderRadius: "999px",
    border: "0",
    backgroundColor: "transparent",
    font: "inherit",
    verticalAlign: "baseline",
    whiteSpace: "nowrap",
    lineHeight: "1.35",
    cursor: "text",
    transition: "background-color 140ms ease, color 140ms ease, box-shadow 140ms ease",
  },
  ".cm-wikilink-chip[data-clickable='true']": {
    cursor: "pointer",
  },
  ".cm-wikilink-chip[data-wikilink-state='exact_id'], .cm-wikilink-chip[data-wikilink-state='exact_l0'], .cm-wikilink-chip[data-wikilink-state='fuzzy_l0']":
    {
      color: "var(--accent)",
      backgroundColor: "color-mix(in srgb, var(--accent-muted) 72%, transparent)",
    },
  ".cm-wikilink-chip[data-clickable='true']:hover": {
    backgroundColor: "color-mix(in srgb, var(--accent-muted) 92%, transparent)",
    boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--accent) 24%, transparent)",
  },
  ".cm-wikilink-chip[data-wikilink-state='ambiguous']": {
    color: "var(--warning)",
    backgroundColor: "color-mix(in srgb, var(--warning) 14%, transparent)",
  },
  ".cm-wikilink-chip[data-wikilink-state='unresolved']": {
    color: "var(--danger)",
    backgroundColor: "color-mix(in srgb, var(--danger) 12%, transparent)",
  },
  ".cm-wikilink-chip-label": {
    overflow: "hidden",
    textOverflow: "ellipsis",
    textDecoration: "none",
    fontWeight: "560",
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
        if (update.docChanged || update.viewportChanged || update.selectionSet) {
          this.decorations = this.buildDecorations(update.view);
        }
      }

      buildDecorations(view: EditorView) {
        const builder = new RangeSetBuilder<Decoration>();
        const activeLines = new Set<number>();

        if (options.revealSyntaxOnActiveLine) {
          for (const range of view.state.selection.ranges) {
            activeLines.add(view.state.doc.lineAt(range.head).number);
          }
        }

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
            builder.add(
              matchFrom,
              matchTo,
              Decoration.replace({
                widget: new WikilinkWidget(inner, resolution, options.onOpenMemory),
              }),
            );
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

    const ranked = rankTargets(query, options.targets).slice(
      0,
      trimmedQuery ? 20 : MAX_EMPTY_QUERY_SUGGESTIONS,
    );
    const completions: Completion[] = ranked.map(({ target, score }) => ({
      label: target.l0 || target.id,
      detail: formatCompletionDetail(target),
      type: completionTypeForOntology(target.ontology),
      boost: score,
      apply(view, _completion, applyFrom, applyTo) {
        insertCanonicalWikilink(view, applyFrom, applyTo, target.id);
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
        label: options.getCreateMemoryLabel?.(draft) ?? `Create memory "${l0}"`,
        detail: options.getCreateMemoryDetail?.(draft) ?? `${id} · unknown`,
        type: "new",
        apply(view, _completion, applyFrom, applyTo) {
          insertCanonicalWikilink(view, applyFrom, applyTo, id);
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

function insertCanonicalWikilink(view: EditorView, from: number, to: number, id: string) {
  const text = `[[${id}]]`;
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
