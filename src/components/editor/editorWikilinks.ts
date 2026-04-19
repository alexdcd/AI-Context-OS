import {
  autocompletion,
  completionKeymap,
  type Completion,
  type CompletionContext,
} from "@codemirror/autocomplete";
import { EditorSelection, type Extension, RangeSetBuilder } from "@codemirror/state";
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

function slugifyMemoryId(value: string): string {
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

function nextUniqueMemoryId(text: string, targets: WikilinkTarget[]): string {
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
    button.style.display = "inline-flex";
    button.style.alignItems = "center";
    button.style.gap = "0.25rem";
    button.style.padding = "0 0.15rem";
    button.style.border = "0";
    button.style.background = "transparent";
    button.style.font = "inherit";
    button.style.cursor = this.isClickable ? "pointer" : "text";
    button.style.whiteSpace = "nowrap";

    const label = document.createElement("span");
    label.textContent = this.label;
    label.style.textDecoration = "underline";
    label.style.textUnderlineOffset = "0.12em";
    label.style.color = this.color;
    button.appendChild(label);

    button.title = this.tooltip;

    if (
      (this.resolution.kind === "exact_id" ||
        this.resolution.kind === "exact_l0" ||
        this.resolution.kind === "fuzzy_l0") &&
      this.onOpenMemory
    ) {
      const targetId = this.resolution.target.id;
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.onOpenMemory?.(targetId);
      });
    }

    return button;
  }

  ignoreEvent() {
    return false;
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

  private get color() {
    switch (this.resolution.kind) {
      case "exact_id":
      case "exact_l0":
      case "fuzzy_l0":
        return "var(--accent)";
      case "ambiguous":
        return "var(--warning)";
      case "unresolved":
        return "var(--danger)";
    }
  }
}

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
    const from = context.pos - query.length - 2;
    const ranked = rankTargets(query, options.targets).slice(0, 20);
    const completions: Completion[] = ranked.map(({ target, score }) => ({
      label: target.l0 || target.id,
      detail: `${target.id} · ${target.ontology}`,
      type: completionTypeForOntology(target.ontology),
      boost: score,
      apply(view, _completion, applyFrom, applyTo) {
        insertCanonicalWikilink(view, applyFrom, applyTo, target.id);
      },
    }));

    if (completions.length === 0 && query.trim() && options.onCreateMemory) {
      const l0 = query.trim();
      const id = nextUniqueMemoryId(l0, options.targets);
      completions.push({
        label: `Create memory \"${l0}\"`,
        detail: `${id} · unknown`,
        type: "new",
        apply(view, _completion, applyFrom, applyTo) {
          insertCanonicalWikilink(view, applyFrom, applyTo, id);
          void options.onCreateMemory?.({ id, l0 });
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
  view.dispatch({
    changes: { from, to, insert: text },
    selection: EditorSelection.cursor(from + text.length),
    scrollIntoView: true,
    userEvent: "input.complete",
  });
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
    createWikilinkPreviewPlugin(options),
    autocompletion({
      override: [createWikilinkCompletionSource(options)],
      activateOnTyping: true,
      defaultKeymap: false,
      closeOnBlur: true,
      selectOnOpen: true,
      tooltipClass: () => "cm-wikilink-completions",
    }),
    keymap.of(completionKeymap),
  ];
}
