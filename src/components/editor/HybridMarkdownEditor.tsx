import { clsx } from "clsx";
import TurndownService from "turndown";
import { open } from "@tauri-apps/plugin-shell";
import CodeMirror from "@uiw/react-codemirror";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import {
  EditorView,
  keymap,
  type KeyBinding,
  ViewPlugin,
  Decoration,
  type DecorationSet,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { useEffect, useMemo, useRef } from "react";
import { tags as t } from "@lezer/highlight";
import { HighlightStyle, syntaxHighlighting, syntaxTree } from "@codemirror/language";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { type StateCommand, EditorSelection, RangeSetBuilder } from "@codemirror/state";

interface Props {
  content: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  className?: string;
  editable?: boolean;
  /** Typography preset — orthogonal to the app-level appearance mode. */
  themeVariant?: "classic" | "clean";
  viewRef?: React.MutableRefObject<EditorView | null>;
  /**
   * When true, markdown markers (#, **, etc.) remain visible on every line
   * (raw view). When false — the default — markers are hidden except on the
   * line under the cursor, like Obsidian's Live Preview.
   */
  showSyntax?: boolean;
}

const editorThemePresets = {
  classic: {
    baseFontSize: "1rem",
    lineHeight: "1.72",
    heading1Size: "1.95em",
    heading2Size: "1.5em",
    heading2Color: "var(--accent)",
    headingBorderStrong: "2px solid color-mix(in srgb, var(--accent) 16%, var(--border))",
    headingBorderSoft: "1px solid color-mix(in srgb, var(--accent) 12%, var(--border))",
  },
  clean: {
    baseFontSize: "0.98rem",
    lineHeight: "1.68",
    heading1Size: "1.78em",
    heading2Size: "1.36em",
    heading2Color: "var(--text-0)",
    headingBorderStrong: "1px solid var(--border)",
    headingBorderSoft: "1px solid color-mix(in srgb, var(--border) 78%, transparent)",
  },
} as const;

function createEditorTheme(variant: keyof typeof editorThemePresets) {
  const preset = editorThemePresets[variant];

  return EditorView.theme({
  "&": {
    backgroundColor: "transparent !important",
    color: "var(--text-0)",
    fontSize: preset.baseFontSize,
    lineHeight: preset.lineHeight,
  },
  ".cm-scroller": {
    fontFamily: "inherit",
  },
  ".cm-content": {
    padding: "0.1rem 0 4rem",
    caretColor: "var(--text-0)",
  },
  "&.cm-focused": {
    outline: "none",
  },
  ".cm-gutters": {
    display: "none",
  },
  ".cm-line": {
    padding: "0.12rem 0",
    fontFamily: "inherit",
    wordWrap: "break-word",
    whiteSpace: "pre-wrap",
  },
  ".cm-activeLine": {
    backgroundColor: "transparent",
  },
  ".cm-selectionBackground, ::selection": {
    backgroundColor: "var(--bg-3) !important",
  },
  ".cm-cursor": {
    borderLeftColor: "var(--text-0)",
  },
  ".cm-line.cm-h1": {
    fontSize: preset.heading1Size,
    fontWeight: "740",
    lineHeight: "1.22",
    letterSpacing: "-0.025em",
    paddingTop: "0.75em",
    paddingBottom: "0.32em",
    borderBottom: preset.headingBorderStrong,
  },
  ".cm-line.cm-h2": {
    fontSize: preset.heading2Size,
    fontWeight: "700",
    lineHeight: "1.26",
    color: preset.heading2Color,
    paddingTop: "0.65em",
    paddingBottom: "0.22em",
    borderBottom: preset.headingBorderSoft,
  },
  ".cm-line.cm-h3": {
    fontSize: "1.24em",
    fontWeight: "670",
    lineHeight: "1.3",
    paddingTop: "0.5em",
  },
  ".cm-line.cm-h4": {
    fontSize: "1.08em",
    fontWeight: "640",
    paddingTop: "0.35em",
  },
  ".cm-line.cm-h5": {
    fontSize: "1em",
    fontWeight: "630",
  },
  ".cm-line.cm-h6": {
    fontSize: "0.94em",
    fontWeight: "620",
    color: "var(--text-2)",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  });
}

const markdownHighlightStyle = HighlightStyle.define([
  { tag: t.heading1, fontWeight: "740", color: "var(--text-0)" },
  { tag: t.heading2, fontWeight: "700", color: "var(--accent)" },
  { tag: t.heading3, fontWeight: "670", color: "var(--text-0)" },
  { tag: t.heading4, fontWeight: "640", color: "var(--text-0)" },
  { tag: t.heading5, fontWeight: "630", color: "var(--text-0)" },
  { tag: t.heading6, fontWeight: "620", color: "var(--text-2)" },
  { tag: t.strong, fontWeight: "760", color: "var(--text-0)" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: t.link, color: "var(--accent)", textDecoration: "underline" },
  { tag: t.url, color: "var(--text-2)" },
  {
    tag: t.monospace,
    fontFamily: '"JetBrains Mono", ui-monospace, monospace',
    color: "var(--text-0)",
    backgroundColor: "color-mix(in srgb, var(--bg-2) 72%, transparent)",
    borderRadius: "4px",
  },
  { tag: [t.processingInstruction, t.meta, t.punctuation], color: "var(--text-2)" },
]);

const headingDecorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = this.buildDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = this.buildDecorations(update.view);
      }
    }

    buildDecorations(view: EditorView) {
      const builder = new RangeSetBuilder<Decoration>();
      for (const { from, to } of view.visibleRanges) {
        syntaxTree(view.state).iterate({
          from,
          to,
          enter(node) {
            if (!node.name.includes("Heading")) return;
            const match = node.name.match(/Heading(\d)/);
            if (!match) return;
            builder.add(node.from, node.from, Decoration.line({ class: `cm-h${match[1]}` }));
          },
        });
      }
      return builder.finish();
    }
  },
  { decorations: (value) => value.decorations },
);

const SVG_NS = "http://www.w3.org/2000/svg";

function buildLinkIconSvg(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("width", "12");
  svg.setAttribute("height", "12");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");

  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6");
  svg.appendChild(path);

  const polyline = document.createElementNS(SVG_NS, "polyline");
  polyline.setAttribute("points", "15 3 21 3 21 9");
  svg.appendChild(polyline);

  const line = document.createElementNS(SVG_NS, "line");
  line.setAttribute("x1", "10");
  line.setAttribute("y1", "14");
  line.setAttribute("x2", "21");
  line.setAttribute("y2", "3");
  svg.appendChild(line);

  return svg;
}

class LinkIconWidget extends WidgetType {
  constructor(public url: string) {
    super();
  }

  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-link-icon";
    span.style.display = "inline-flex";
    span.style.alignItems = "center";
    span.style.marginLeft = "4px";
    span.style.color = "var(--text-2)";
    span.style.cursor = "pointer";
    span.appendChild(buildLinkIconSvg());

    span.addEventListener("click", (e) => {
      open(this.url).catch(console.error);
      e.preventDefault();
      e.stopPropagation();
    });

    return span;
  }
}

const livePreviewPlugin = ViewPlugin.fromClass(
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
      const state = view.state;

      const activeLines = new Set<number>();
      for (const range of state.selection.ranges) {
        activeLines.add(state.doc.lineAt(range.head).number);
      }

      const hideDeco = Decoration.replace({});
      const linkPreviewMark = Decoration.mark({ class: "cm-link-preview" });
      const decos: { from: number; to: number; deco: Decoration }[] = [];

      for (const { from, to } of view.visibleRanges) {
        syntaxTree(state).iterate({
          from,
          to,
          enter(node) {
            const isHiddenMarker = [
              "HeaderMark",
              "EmphasisMark",
              "StrongEmphasisMark",
              "StrikethroughMark",
              "CodeMark",
              "LinkMark",
            ].includes(node.name);

            const line = state.doc.lineAt(node.from).number;
            if (activeLines.has(line)) return;

            if (isHiddenMarker) {
              decos.push({ from: node.from, to: node.to, deco: hideDeco });
            } else if (node.name === "URL" && node.node.parent?.name === "Link") {
              const urlText = state
                .sliceDoc(node.from, node.to)
                .replace(/^[(<]/, "")
                .replace(/[)>]$/, "");
              decos.push({
                from: node.from,
                to: node.to,
                deco: Decoration.replace({ widget: new LinkIconWidget(urlText) }),
              });
            } else if (node.name === "Link") {
              const firstChild = node.node.firstChild;
              const lastChild = node.node.lastChild;
              if (firstChild && lastChild) {
                const textFrom = firstChild.to;
                const textTo =
                  firstChild.nextSibling?.name === "LinkMark"
                    ? firstChild.nextSibling.from
                    : lastChild.from;
                if (textTo > textFrom) {
                  decos.push({ from: textFrom, to: textTo, deco: linkPreviewMark });
                }
              }
            }
          },
        });
      }

      decos.sort((a, b) => a.from - b.from || a.to - b.to);
      for (const d of decos) {
        builder.add(d.from, d.to, d.deco);
      }

      return builder.finish();
    }
  },
  { decorations: (v) => v.decorations },
);

function applyToggleMark(view: EditorView, mark: string) {
  const { state } = view;
  const changes = state.changeByRange((range) => {
    const normalized = normalizeInlineRange(state.doc, range.from, range.to);

    if (range.empty) {
      return {
        changes: [{ from: range.from, insert: mark + mark }],
        range: EditorSelection.range(range.from + mark.length, range.from + mark.length),
      };
    }

    const alreadyWrapped =
      normalized.from >= mark.length &&
      normalized.to <= state.doc.length - mark.length &&
      state.sliceDoc(normalized.from - mark.length, normalized.from) === mark &&
      state.sliceDoc(normalized.to, normalized.to + mark.length) === mark;

    if (alreadyWrapped) {
      return {
        changes: [
          { from: normalized.from - mark.length, to: normalized.from },
          { from: normalized.to, to: normalized.to + mark.length },
        ],
        range: EditorSelection.range(normalized.from - mark.length, normalized.to - mark.length),
      };
    }

    return {
      changes: [
        { from: normalized.from, insert: mark },
        { from: normalized.to, insert: mark },
      ],
      range: EditorSelection.range(normalized.from + mark.length, normalized.to + mark.length),
    };
  });

  view.dispatch(state.update(changes, { scrollIntoView: true, userEvent: "input" }));
}

function normalizeInlineRange(
  doc: { lineAt: (pos: number) => { from: number; to: number; text: string }; sliceString: (from: number, to: number) => string },
  from: number,
  to: number,
) {
  let nextFrom = from;
  let nextTo = to;

  while (nextTo > nextFrom) {
    const char = doc.sliceString(nextTo - 1, nextTo);
    if (char !== "\n" && char !== "\r") break;
    nextTo -= 1;
  }

  const line = doc.lineAt(nextFrom);
  if (nextFrom === line.from && nextTo >= line.to) {
    const prefixMatch = line.text.match(/^(\s*(?:[-*+]\s|\d+\.\s|- \[[ xX]\]\s|>\s))/);
    if (prefixMatch) {
      nextFrom += prefixMatch[0].length;
    }
  }

  return nextTo < nextFrom ? { from, to } : { from: nextFrom, to: nextTo };
}

function getContentSelectionForLine(
  doc: { lineAt: (pos: number) => { from: number; to: number; text: string } },
  pos: number,
) {
  const line = doc.lineAt(pos);
  const prefixMatch = line.text.match(/^(\s*(?:[-*+]\s|\d+\.\s|- \[[ xX]\]\s|>\s))/);
  const leadingTrimmed = line.text.replace(/^\s+/, "");
  const trailingWhitespaceMatch = line.text.match(/\s+$/);

  let from = line.from + (prefixMatch?.[0].length ?? 0);
  let to = line.to - (trailingWhitespaceMatch?.[0].length ?? 0);

  if (!leadingTrimmed.length) {
    from = line.from;
    to = line.to;
  }

  if (to < from) {
    from = line.from;
    to = line.to;
  }

  return { from, to };
}

function applyToggleLinePrefix(view: EditorView, prefix: string) {
  const { state } = view;
  const changes = state.changeByRange((range) => {
    const startLine = state.doc.lineAt(range.from);
    const endLine = state.doc.lineAt(range.to);
    const nextChanges: { from: number; to: number; insert: string }[] = [];

    for (let lineNumber = startLine.number; lineNumber <= endLine.number; lineNumber += 1) {
      const line = state.doc.line(lineNumber);
      const headingMatch = line.text.match(/^#{1,6}\s+/);
      if (headingMatch && line.text.startsWith(prefix)) {
        nextChanges.push({ from: line.from, to: line.from + prefix.length, insert: "" });
      } else if (headingMatch) {
        nextChanges.push({ from: line.from, to: line.from + headingMatch[0].length, insert: prefix });
      } else {
        nextChanges.push({ from: line.from, to: line.from, insert: prefix });
      }
    }

    const delta = nextChanges.reduce(
      (acc, change) => acc + (change.insert.length - (change.to - change.from)),
      0,
    );

    return {
      changes: nextChanges,
      range: EditorSelection.range(range.from, range.to + delta),
    };
  });

  view.dispatch(state.update(changes, { scrollIntoView: true, userEvent: "input" }));
}

function insertMarkdownLink(view: EditorView) {
  const { state } = view;
  const range = state.selection.main;
  const selected = state.sliceDoc(range.from, range.to) || "texto";
  const insert = `[${selected}](url)`;
  view.dispatch({
    changes: { from: range.from, to: range.to, insert },
    selection: EditorSelection.range(range.from + selected.length + 3, range.from + selected.length + 6),
    scrollIntoView: true,
    userEvent: "input",
  });
}

function toggleMark(mark: string): StateCommand {
  return (target) => {
    applyToggleMark(target as unknown as EditorView, mark);
    return true;
  };
}

function toggleLinePrefixCommand(prefix: string): StateCommand {
  return (target) => {
    applyToggleLinePrefix(target as unknown as EditorView, prefix);
    return true;
  };
}

function wrapWith(mark: string): StateCommand {
  return ({ state, dispatch }) => {
    if (state.selection.ranges.every((range) => range.empty)) return false;

    const changes = state.changeByRange((range) => {
      if (range.empty) return { range };
      const normalized = normalizeInlineRange(state.doc, range.from, range.to);
      return {
        changes: [
          { from: normalized.from, insert: mark },
          { from: normalized.to, insert: mark },
        ],
        range: EditorSelection.range(normalized.from + mark.length, normalized.to + mark.length),
      };
    });

    dispatch(state.update(changes, { scrollIntoView: true, userEvent: "input" }));
    return true;
  };
}

const markdownKeymap: KeyBinding[] = [
  { key: "Mod-b", run: toggleMark("**") },
  { key: "Mod-i", run: toggleMark("*") },
  { key: "Mod-e", run: toggleMark("`") },
  {
    key: "Mod-k",
    run: (target) => {
      insertMarkdownLink(target as unknown as EditorView);
      return true;
    },
  },
  { key: "Mod-1", run: toggleLinePrefixCommand("# ") },
  { key: "Mod-2", run: toggleLinePrefixCommand("## ") },
  { key: "Mod-3", run: toggleLinePrefixCommand("### ") },
  { key: "Mod-Shift-x", run: toggleMark("~~") },
  { key: "*", run: wrapWith("*") },
  { key: "_", run: wrapWith("_") },
  { key: "`", run: wrapWith("`") },
  { key: "~", run: wrapWith("~") },
];

const turndownService = new TurndownService({
  headingStyle: "atx",
  hr: "---",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
  emDelimiter: "*",
  strongDelimiter: "**",
});

const domHandlers = EditorView.domEventHandlers({
  keydown(event, view) {
    const isMod = event.metaKey || event.ctrlKey;
    if (!isMod) return false;

    const key = event.key.toLowerCase();
    if (key === "b") {
      event.preventDefault();
      applyToggleMark(view, "**");
      return true;
    }
    if (key === "i") {
      event.preventDefault();
      applyToggleMark(view, "*");
      return true;
    }
    if (key === "e") {
      event.preventDefault();
      applyToggleMark(view, "`");
      return true;
    }
    if (key === "k") {
      event.preventDefault();
      insertMarkdownLink(view);
      return true;
    }
    if (key === "1" || key === "2" || key === "3") {
      event.preventDefault();
      applyToggleLinePrefix(view, key === "1" ? "# " : key === "2" ? "## " : "### ");
      return true;
    }
    if (event.shiftKey && key === "x") {
      event.preventDefault();
      applyToggleMark(view, "~~");
      return true;
    }

    return false;
  },

  paste(event, view) {
    const data = event.clipboardData;
    if (!data) return false;
    if (data.getData("vscode-editor-data") || data.getData("text/plain").includes("```")) {
      return false;
    }

    const html = data.getData("text/html");
    if (!html) return false;

    try {
      const parsedMarkdown = turndownService.turndown(html);
      if (!parsedMarkdown) return false;

      const changes = view.state.changeByRange((range) => ({
        changes: [{ from: range.from, to: range.to, insert: parsedMarkdown }],
        range: EditorSelection.range(range.from + parsedMarkdown.length, range.from + parsedMarkdown.length),
      }));

      view.dispatch(view.state.update(changes, { scrollIntoView: true, userEvent: "input.paste" }));
      event.preventDefault();
      return true;
    } catch (error) {
      console.error("Paste Turndown Error:", error);
      return false;
    }
  },

  dblclick(event, view) {
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos === null) return false;

    const selection = getContentSelectionForLine(view.state.doc, pos);
    if (selection.from === selection.to) return false;

    view.dispatch({
      selection: EditorSelection.range(selection.from, selection.to),
      scrollIntoView: true,
      userEvent: "select.pointer",
    });
    event.preventDefault();
    return true;
  },
});

export function HybridMarkdownEditor({
  content,
  onChange,
  onBlur,
  placeholder,
  className,
  editable = true,
  themeVariant = "classic",
  viewRef,
  showSyntax = false,
}: Props) {
  const localRef = useRef<EditorView | null>(null);

  useEffect(
    () => () => {
      if (viewRef && viewRef.current === localRef.current) {
        viewRef.current = null;
      }
    },
    [viewRef],
  );

  const extensions = useMemo(
    () => [
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      EditorView.lineWrapping,
      createEditorTheme(themeVariant),
      headingDecorations,
      ...(showSyntax ? [] : [livePreviewPlugin]),
      syntaxHighlighting(markdownHighlightStyle),
      history(),
      keymap.of(markdownKeymap),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      domHandlers,
    ],
    [themeVariant, showSyntax],
  );

  return (
    <div className={clsx("h-full w-full text-[0.9375rem] leading-[1.65]", className)}>
      <CodeMirror
        value={content}
        onChange={(value) => onChange(value)}
        onBlur={onBlur}
        editable={editable}
        placeholder={placeholder}
        extensions={extensions}
        onCreateEditor={(view) => {
          localRef.current = view;
          if (viewRef) viewRef.current = view;
        }}
        basicSetup={{
          lineNumbers: false,
          foldGutter: false,
          dropCursor: false,
          allowMultipleSelections: true,
          indentOnInput: false,
          highlightActiveLine: false,
          highlightActiveLineGutter: false,
          crosshairCursor: false,
          bracketMatching: true,
          autocompletion: false,
          closeBrackets: true,
          highlightSelectionMatches: false,
        }}
      />
    </div>
  );
}
