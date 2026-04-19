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
import { useTranslation } from "react-i18next";
import { applyLinePrefixToggle, insertMarkdownLink, normalizeInlineRange } from "./editorCommands";
import {
  createWikilinkExtensions,
  type WikilinkDraftMemory,
  type WikilinkTarget,
} from "./editorWikilinks";

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
  /** When false, preview mode never reveals raw markdown on click/focus. */
  revealSyntaxOnActiveLine?: boolean;
  wikilinkTargets?: WikilinkTarget[];
  onOpenWikilink?: (id: string) => void;
  onCreateWikilinkMemory?: (draft: WikilinkDraftMemory) => void | Promise<void>;
}

interface TaskPriorityLabels {
  high: string;
  medium: string;
  low: string;
}

const EMPTY_WIKILINK_TARGETS: WikilinkTarget[] = [];
const EDITOR_BASIC_SETUP = {
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
} as const;

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
    ".cm-line.cm-blockquote": {
      marginLeft: "0.1rem",
      paddingLeft: "0.95rem",
      borderLeft: "3px solid color-mix(in srgb, var(--accent) 28%, var(--border))",
      color: "var(--text-1)",
      backgroundColor: "color-mix(in srgb, var(--accent-muted) 55%, transparent)",
    },
    ".cm-line.cm-bullet-item": {
      position: "relative",
      paddingLeft: "1.15rem",
    },
    ".cm-line.cm-list-depth-1": {
      marginLeft: "0",
    },
    ".cm-line.cm-list-depth-2": {
      marginLeft: "1rem",
    },
    ".cm-line.cm-list-depth-3": {
      marginLeft: "2rem",
    },
    ".cm-line.cm-list-depth-4": {
      marginLeft: "3rem",
    },
    ".cm-line.cm-bullet-item::before": {
      content: '""',
      position: "absolute",
      left: "0.2rem",
      top: "0.9em",
      width: "0.36rem",
      height: "0.36rem",
      borderRadius: "999px",
      backgroundColor: "color-mix(in srgb, var(--text-1) 88%, transparent)",
      transform: "translateY(-50%)",
    },
    ".cm-line.cm-ordered-item": {
      position: "relative",
      paddingLeft: "2rem",
    },
    ".cm-line.cm-ordered-item::before": {
      content: "attr(data-list-index) '.'",
      position: "absolute",
      left: "0",
      top: "0.12rem",
      width: "1.5rem",
      color: "var(--text-2)",
      fontSize: "0.88em",
      fontWeight: "700",
      textAlign: "right",
      fontVariantNumeric: "tabular-nums",
    },
    ".cm-line.cm-task-item": {
      position: "relative",
      paddingLeft: "1.75rem",
    },
    ".cm-line.cm-task-item::before": {
      content: '""',
      position: "absolute",
      left: "0.1rem",
      top: "0.82em",
      width: "0.8rem",
      height: "0.8rem",
      borderRadius: "0.24rem",
      border: "1.5px solid color-mix(in srgb, var(--text-2) 72%, transparent)",
      backgroundColor: "transparent",
      transform: "translateY(-50%)",
      boxSizing: "border-box",
    },
    ".cm-line.cm-task-item.cm-task-checked::before": {
      backgroundColor: "color-mix(in srgb, var(--accent) 90%, transparent)",
      borderColor: "color-mix(in srgb, var(--accent) 90%, transparent)",
      boxShadow: "inset 0 0 0 1px color-mix(in srgb, white 35%, transparent)",
    },
    ".cm-line.cm-task-item.cm-task-checked::after": {
      content: '""',
      position: "absolute",
      left: "0.38rem",
      top: "0.79em",
      width: "0.22rem",
      height: "0.45rem",
      borderRight: "2px solid white",
      borderBottom: "2px solid white",
      transform: "translateY(-58%) rotate(45deg)",
    },
    ".cm-task-priority-badge": {
      display: "inline-flex",
      alignItems: "center",
      marginRight: "0.42rem",
      padding: "0.02rem 0.32rem",
      borderRadius: "999px",
      fontFamily: '"JetBrains Mono", ui-monospace, monospace',
      fontSize: "0.72rem",
      fontWeight: "700",
      lineHeight: "1.2",
      verticalAlign: "baseline",
    },
    ".cm-task-priority-a": {
      color: "var(--danger)",
      backgroundColor: "color-mix(in srgb, var(--danger) 12%, transparent)",
    },
    ".cm-task-priority-b": {
      color: "var(--warning)",
      backgroundColor: "color-mix(in srgb, var(--warning) 16%, transparent)",
    },
    ".cm-task-priority-c": {
      color: "var(--text-2)",
      backgroundColor: "color-mix(in srgb, var(--text-2) 12%, transparent)",
    },
    ".cm-line.cm-codeblock": {
      fontFamily: '"JetBrains Mono", ui-monospace, monospace',
      fontSize: "0.92em",
      backgroundColor: "color-mix(in srgb, var(--bg-2) 92%, transparent)",
      color: "var(--text-0)",
      paddingLeft: "0.95rem",
      paddingRight: "0.95rem",
    },
    ".cm-line.cm-codeblock-start": {
      marginTop: "0.7rem",
      paddingTop: "0.55rem",
      borderTopLeftRadius: "14px",
      borderTopRightRadius: "14px",
      borderTop: "1px solid color-mix(in srgb, var(--border) 84%, transparent)",
      borderLeft: "1px solid color-mix(in srgb, var(--border) 84%, transparent)",
      borderRight: "1px solid color-mix(in srgb, var(--border) 84%, transparent)",
      color: "var(--text-2)",
      fontSize: "0.76em",
      letterSpacing: "0.06em",
      textTransform: "uppercase",
    },
    ".cm-line.cm-codeblock-start::before": {
      content: "attr(data-code-language)",
    },
    ".cm-line.cm-codeblock-body": {
      borderLeft: "1px solid color-mix(in srgb, var(--border) 84%, transparent)",
      borderRight: "1px solid color-mix(in srgb, var(--border) 84%, transparent)",
    },
    ".cm-line.cm-codeblock-end": {
      paddingBottom: "0.55rem",
      borderBottomLeftRadius: "14px",
      borderBottomRightRadius: "14px",
      borderBottom: "1px solid color-mix(in srgb, var(--border) 84%, transparent)",
      borderLeft: "1px solid color-mix(in srgb, var(--border) 84%, transparent)",
      borderRight: "1px solid color-mix(in srgb, var(--border) 84%, transparent)",
      color: "var(--text-2)",
      fontSize: "0.76em",
    },
    ".cm-line.cm-hr": {
      height: "0",
      paddingTop: "1rem",
      marginTop: "0.4rem",
      marginBottom: "1.1rem",
      borderTop: "1px solid color-mix(in srgb, var(--border) 88%, transparent)",
    },
    ".cm-line.cm-table-header, .cm-line.cm-table-row": {
      paddingLeft: "0.75rem",
      paddingRight: "0.75rem",
      backgroundColor: "color-mix(in srgb, var(--bg-2) 78%, transparent)",
      borderLeft: "1px solid color-mix(in srgb, var(--border) 84%, transparent)",
      borderRight: "1px solid color-mix(in srgb, var(--border) 84%, transparent)",
      fontFamily: '"JetBrains Mono", ui-monospace, monospace',
      fontSize: "0.92em",
    },
    ".cm-line.cm-table-header": {
      marginTop: "0.7rem",
      paddingTop: "0.55rem",
      paddingBottom: "0.45rem",
      fontWeight: "700",
      borderTopLeftRadius: "12px",
      borderTopRightRadius: "12px",
      borderTop: "1px solid color-mix(in srgb, var(--border) 84%, transparent)",
    },
    ".cm-line.cm-table-separator": {
      height: "0",
      paddingTop: "0",
      marginBottom: "0",
      borderTop: "1px solid color-mix(in srgb, var(--border) 84%, transparent)",
      borderLeft: "1px solid color-mix(in srgb, var(--border) 84%, transparent)",
      borderRight: "1px solid color-mix(in srgb, var(--border) 84%, transparent)",
      backgroundColor: "color-mix(in srgb, var(--bg-2) 78%, transparent)",
    },
    ".cm-line.cm-table-row:last-of-type": {
      borderBottom: "1px solid color-mix(in srgb, var(--border) 84%, transparent)",
      borderBottomLeftRadius: "12px",
      borderBottomRightRadius: "12px",
      paddingBottom: "0.55rem",
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

function addLineClass(
  builder: RangeSetBuilder<Decoration>,
  lineFrom: number,
  className: string,
) {
  builder.add(lineFrom, lineFrom, Decoration.line({ class: className }));
}

function addLineAttributes(
  builder: RangeSetBuilder<Decoration>,
  lineFrom: number,
  attributes: Record<string, string>,
) {
  builder.add(lineFrom, lineFrom, Decoration.line({ attributes }));
}

function getListDepth(node: { parent: { name: string; parent: any } | null }) {
  let depth = 0;
  let current = node.parent;
  while (current) {
    if (current.name === "BulletList" || current.name === "OrderedList") depth += 1;
    current = current.parent;
  }
  return Math.min(Math.max(depth, 1), 4);
}

const structuralDecorations = ViewPlugin.fromClass(
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
          enter: (node) => {
            if (node.name.includes("Heading")) {
              const match = node.name.match(/Heading(\d)/);
              if (!match) return;
              addLineClass(builder, node.from, `cm-h${match[1]}`);
              return;
            }

            if (node.name === "Blockquote") {
              let line = view.state.doc.lineAt(node.from);
              const endLine = view.state.doc.lineAt(Math.max(node.from, node.to - 1));
              while (line.number <= endLine.number) {
                addLineClass(builder, line.from, "cm-blockquote");
                if (line.number === endLine.number) break;
                line = view.state.doc.line(line.number + 1);
              }
              return;
            }

            if (node.name === "ListItem" && node.node.parent?.name === "BulletList") {
              let hasTaskChild = false;
              let taskMarker: string | null = null;
              const depth = getListDepth(node.node);
              for (let child = node.node.firstChild; child; child = child.nextSibling) {
                if (child.name === "Task") {
                  hasTaskChild = true;
                  for (let taskChild = child.firstChild; taskChild; taskChild = taskChild.nextSibling) {
                    if (taskChild.name === "TaskMarker") {
                      taskMarker = view.state.doc.sliceString(taskChild.from, taskChild.to);
                      break;
                    }
                  }
                  break;
                }
              }
              if (hasTaskChild) {
                addLineClass(builder, node.from, "cm-task-item");
                addLineClass(builder, node.from, `cm-list-depth-${depth}`);
                if (taskMarker?.toLowerCase().includes("x")) {
                  addLineClass(builder, node.from, "cm-task-checked");
                }
              } else {
                addLineClass(builder, node.from, "cm-bullet-item");
                addLineClass(builder, node.from, `cm-list-depth-${depth}`);
              }
              return;
            }

            if (node.name === "ListItem" && node.node.parent?.name === "OrderedList") {
              const depth = getListDepth(node.node);
              const listMark = node.node.firstChild;
              const markerText =
                listMark?.name === "ListMark"
                  ? view.state.doc.sliceString(listMark.from, listMark.to).replace(/\.$/, "")
                  : "";
              addLineClass(builder, node.from, "cm-ordered-item");
              addLineClass(builder, node.from, `cm-list-depth-${depth}`);
              addLineAttributes(builder, node.from, { "data-list-index": markerText });
              return;
            }

            if (node.name === "TableHeader") {
              addLineClass(builder, node.from, "cm-table-header");
              return;
            }

            if (node.name === "TableDelimiter") {
              const line = view.state.doc.lineAt(node.from);
              if (line.from === node.from) {
                addLineClass(builder, node.from, "cm-table-separator");
              }
              return;
            }

            if (node.name === "TableRow") {
              addLineClass(builder, node.from, "cm-table-row");
              return;
            }

            if (node.name === "FencedCode") {
              const startLine = view.state.doc.lineAt(node.from);
              const endLine = view.state.doc.lineAt(Math.max(node.from, node.to - 1));
              let language = "";
              for (let child = node.node.firstChild; child; child = child.nextSibling) {
                if (child.name === "CodeInfo") {
                  language = view.state.doc.sliceString(child.from, child.to).trim();
                  break;
                }
              }
              for (let lineNumber = startLine.number; lineNumber <= endLine.number; lineNumber += 1) {
                const line = view.state.doc.line(lineNumber);
                addLineClass(builder, line.from, "cm-codeblock");
                if (lineNumber === startLine.number) {
                  addLineClass(builder, line.from, "cm-codeblock-start");
                  addLineAttributes(builder, line.from, { "data-code-language": language || "code" });
                } else if (lineNumber === endLine.number) {
                  addLineClass(builder, line.from, "cm-codeblock-end");
                } else {
                  addLineClass(builder, line.from, "cm-codeblock-body");
                }
              }
              return;
            }

            if (node.name === "HorizontalRule") {
              addLineClass(builder, node.from, "cm-hr");
              return;
            }

            if (node.name === "Image") {
              const raw = view.state.doc.sliceString(node.from, node.to);
              const match = raw.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
              if (!match) return;
              builder.add(
                node.from,
                node.to,
                Decoration.replace({ widget: new ImagePreviewWidget(match[1], match[2]) }),
              );
            }
          },
        });
      }
      return builder.finish();
    }
  },
  { decorations: (value) => value.decorations },
);

const SVG_NS = "http://www.w3.org/2000/svg";

function stopWidgetEvent(event: Event) {
  event.preventDefault();
  event.stopPropagation();
}

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

    span.addEventListener("mousedown", stopWidgetEvent);
    span.addEventListener("mouseup", stopWidgetEvent);
    span.addEventListener("pointerdown", stopWidgetEvent);
    span.addEventListener("pointerup", stopWidgetEvent);
    span.addEventListener("click", (e) => {
      stopWidgetEvent(e);
      open(this.url).catch(console.error);
    });

    return span;
  }

  ignoreEvent() {
    return true;
  }
}

class ImagePreviewWidget extends WidgetType {
  constructor(public alt: string, public url: string) {
    super();
  }

  toDOM() {
    const root = document.createElement("button");
    root.type = "button";
    root.className = "cm-image-card";
    root.style.display = "flex";
    root.style.width = "100%";
    root.style.alignItems = "center";
    root.style.gap = "0.75rem";
    root.style.margin = "0.5rem 0";
    root.style.padding = "0.8rem 0.9rem";
    root.style.border = "1px solid color-mix(in srgb, var(--border) 84%, transparent)";
    root.style.borderRadius = "14px";
    root.style.background = "color-mix(in srgb, var(--bg-2) 78%, transparent)";
    root.style.cursor = "pointer";
    root.style.textAlign = "left";

    const preview = document.createElement("div");
    preview.style.display = "flex";
    preview.style.height = "3rem";
    preview.style.width = "3rem";
    preview.style.flexShrink = "0";
    preview.style.alignItems = "center";
    preview.style.justifyContent = "center";
    preview.style.borderRadius = "10px";
    preview.style.background = "color-mix(in srgb, var(--bg-3) 88%, transparent)";
    preview.style.color = "var(--text-2)";
    preview.textContent = "🖼";

    if (/\.(png|jpe?g|gif|webp|svg|avif)$/i.test(this.url) || this.url.startsWith("data:image/")) {
      const img = document.createElement("img");
      img.src = this.url;
      img.alt = this.alt;
      img.style.height = "100%";
      img.style.width = "100%";
      img.style.objectFit = "cover";
      img.style.borderRadius = "10px";
      preview.replaceChildren(img);
    }

    const text = document.createElement("div");
    text.style.minWidth = "0";
    text.style.display = "flex";
    text.style.flexDirection = "column";
    text.style.gap = "0.2rem";

    const title = document.createElement("div");
    title.textContent = this.alt || "Image";
    title.style.color = "var(--text-0)";
    title.style.fontWeight = "600";

    const meta = document.createElement("div");
    meta.textContent = this.url;
    meta.style.color = "var(--text-2)";
    meta.style.fontSize = "0.78rem";
    meta.style.overflow = "hidden";
    meta.style.textOverflow = "ellipsis";
    meta.style.whiteSpace = "nowrap";

    text.append(title, meta);
    root.append(preview, text);

    root.addEventListener("mousedown", stopWidgetEvent);
    root.addEventListener("mouseup", stopWidgetEvent);
    root.addEventListener("pointerdown", stopWidgetEvent);
    root.addEventListener("pointerup", stopWidgetEvent);
    root.addEventListener("click", (e) => {
      stopWidgetEvent(e);
      open(this.url).catch(console.error);
    });

    return root;
  }

  ignoreEvent() {
    return true;
  }
}

class TaskPriorityWidget extends WidgetType {
  constructor(
    public priority: "A" | "B" | "C",
    public labels: TaskPriorityLabels,
    public editable: boolean,
    public onSelect: (priority: "A" | "B" | "C") => void,
  ) {
    super();
  }

  toDOM() {
    const root = document.createElement("span");
    root.style.position = "relative";
    root.style.display = "inline-flex";
    root.style.marginLeft = "0.5rem";
    root.style.verticalAlign = "middle";

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = `cm-task-priority-badge cm-task-priority-${this.priority.toLowerCase()}`;
    trigger.textContent = this.priority;
    trigger.title = this.getLabel(this.priority);
    trigger.disabled = !this.editable;
    trigger.style.cursor = this.editable ? "pointer" : "default";
    trigger.style.border = "none";

    const menu = document.createElement("div");
    menu.style.position = "absolute";
    menu.style.right = "0";
    menu.style.top = "calc(100% + 0.35rem)";
    menu.style.display = "none";
    menu.style.minWidth = "7.5rem";
    menu.style.padding = "0.3rem";
    menu.style.borderRadius = "0.65rem";
    menu.style.border = "1px solid color-mix(in srgb, var(--border) 84%, transparent)";
    menu.style.background = "var(--bg-0)";
    menu.style.boxShadow = "0 8px 24px rgba(0, 0, 0, 0.12)";
    menu.style.zIndex = "20";

    const closeMenu = () => {
      menu.style.display = "none";
    };

    const toggleMenu = (event: Event) => {
      stopWidgetEvent(event);
      if (!this.editable) return;
      menu.style.display = menu.style.display === "none" ? "block" : "none";
    };

    trigger.addEventListener("mousedown", stopWidgetEvent);
    trigger.addEventListener("mouseup", stopWidgetEvent);
    trigger.addEventListener("pointerdown", stopWidgetEvent);
    trigger.addEventListener("pointerup", stopWidgetEvent);
    trigger.addEventListener("click", toggleMenu);

    const options: Array<["A" | "B" | "C", string]> = [
      ["A", this.labels.high],
      ["B", this.labels.medium],
      ["C", this.labels.low],
    ];

    for (const [priority, label] of options) {
      const option = document.createElement("button");
      option.type = "button";
      option.style.display = "flex";
      option.style.width = "100%";
      option.style.alignItems = "center";
      option.style.gap = "0.55rem";
      option.style.padding = "0.38rem 0.5rem";
      option.style.border = "none";
      option.style.borderRadius = "0.5rem";
      option.style.background = priority === this.priority ? "var(--bg-2)" : "transparent";
      option.style.cursor = "pointer";

      const badge = document.createElement("span");
      badge.className = `cm-task-priority-badge cm-task-priority-${priority.toLowerCase()}`;
      badge.textContent = priority;

      const text = document.createElement("span");
      text.textContent = label;
      text.style.color = "var(--text-1)";
      text.style.fontSize = "0.8rem";

      option.append(badge, text);
      option.addEventListener("mousedown", stopWidgetEvent);
      option.addEventListener("mouseup", stopWidgetEvent);
      option.addEventListener("pointerdown", stopWidgetEvent);
      option.addEventListener("pointerup", stopWidgetEvent);
      option.addEventListener("click", (event) => {
        stopWidgetEvent(event);
        this.onSelect(priority);
        closeMenu();
      });
      menu.append(option);
    }

    root.addEventListener("mouseleave", () => {
      closeMenu();
    });

    root.append(trigger, menu);
    return root;
  }

  getLabel(priority: "A" | "B" | "C") {
    if (priority === "A") return this.labels.high;
    if (priority === "B") return this.labels.medium;
    return this.labels.low;
  }

  ignoreEvent() {
    return true;
  }
}

function setTaskPriorityOnLine(view: EditorView, lineNumber: number, priority: "A" | "B" | "C") {
  const line = view.state.doc.line(lineNumber);
  const match = line.text.match(/^(\s*-\s\[[ xX]\]\s+)(\[#([ABCabc])\]\s+)?/);
  if (!match) return false;

  const insertFrom = line.from + match[1].length;
  const insertTo = insertFrom + (match[2]?.length ?? 0);
  const marker = `[#${priority}] `;

  view.dispatch({
    changes: { from: insertFrom, to: insertTo, insert: marker },
    selection: view.state.selection,
    scrollIntoView: false,
    userEvent: "input",
  });
  view.focus();
  return true;
}

function createLivePreviewPlugin(
  revealSyntaxOnActiveLine: boolean,
  editable: boolean,
  priorityLabels: TaskPriorityLabels,
) {
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
        const state = view.state;

        const activeLines = new Set<number>();
        if (revealSyntaxOnActiveLine) {
          for (const range of state.selection.ranges) {
            activeLines.add(state.doc.lineAt(range.head).number);
          }
        }

        const hideDeco = Decoration.replace({});
        const linkPreviewMark = Decoration.mark({ class: "cm-link-preview" });
        const decos: { from: number; to: number; deco: Decoration }[] = [];
        const decoratedTaskPriorityLines = new Set<number>();

        for (const { from, to } of view.visibleRanges) {
          syntaxTree(state).iterate({
            from,
            to,
            enter(node) {
              const alwaysHiddenMarkers = [
                "QuoteMark",
                "HorizontalRule",
                "ListMark",
                "TaskMarker",
                "TableDelimiter",
              ];
              const activeLineHiddenMarkers = [
                "HeaderMark",
                "EmphasisMark",
                "StrongEmphasisMark",
                "StrikethroughMark",
                "CodeMark",
                "LinkMark",
                "CodeInfo",
              ];
              const isAlwaysHiddenMarker = alwaysHiddenMarkers.includes(node.name);
              const isActiveLineHiddenMarker = activeLineHiddenMarkers.includes(node.name);

              const line = state.doc.lineAt(node.from).number;
              if (activeLines.has(line) && !isAlwaysHiddenMarker) return;

              if (isAlwaysHiddenMarker || isActiveLineHiddenMarker) {
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

          let line = state.doc.lineAt(from);
          const endLine = state.doc.lineAt(Math.max(from, to - 1));
          while (line.number <= endLine.number) {
            if (!activeLines.has(line.number) && !decoratedTaskPriorityLines.has(line.number)) {
              const taskMatch = line.text.match(/^(\s*-\s\[[ xX]\]\s+)(\[#([ABCabc])\]\s+)?/);
              if (taskMatch) {
                const currentPriority = (taskMatch[3]?.toUpperCase() ?? "B") as "A" | "B" | "C";
                const markerFrom = line.from + priorityMatch[1].length;
                const markerTo = markerFrom + (taskMatch[2]?.length ?? 0);
                if (taskMatch[2]) {
                  decos.push({
                    from: markerFrom,
                    to: markerTo,
                    deco: hideDeco,
                  });
                }
                decos.push({
                  from: line.to,
                  to: line.to,
                  deco: Decoration.widget({
                    side: 1,
                    widget: new TaskPriorityWidget(
                      currentPriority,
                      priorityLabels,
                      editable,
                      (nextPriority) => {
                        void setTaskPriorityOnLine(view, line.number, nextPriority);
                      },
                    ),
                  }),
                });
                decoratedTaskPriorityLines.add(line.number);
              }
            }

            if (line.number === endLine.number) break;
            line = state.doc.line(line.number + 1);
          }
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
}

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

function applyToggleLinePrefix(view: EditorView, prefix: string) {
  applyLinePrefixToggle(view, prefix);
}

function toggleTaskCheckboxOnLine(view: EditorView, lineNumber: number) {
  const line = view.state.doc.line(lineNumber);
  const match = line.text.match(/^(\s*-\s\[)( |x|X)(\]\s+)/);
  if (!match) return false;

  const markerFrom = line.from + match[1].length;
  const markerTo = markerFrom + 1;
  const nextMarker = match[2].toLowerCase() === "x" ? " " : "x";

  view.dispatch({
    changes: { from: markerFrom, to: markerTo, insert: nextMarker },
    selection: view.state.selection,
    scrollIntoView: false,
    userEvent: "input",
  });
  view.focus();
  return true;
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

function createMarkdownKeymap(linkTextPlaceholder: string): KeyBinding[] {
  return [
    { key: "Mod-b", run: toggleMark("**"), preventDefault: true },
    { key: "Mod-i", run: toggleMark("*"), preventDefault: true },
    { key: "Mod-e", run: toggleMark("`"), preventDefault: true },
    {
      key: "Mod-k",
      preventDefault: true,
      run: (target) => {
        insertMarkdownLink(target as unknown as EditorView, linkTextPlaceholder);
        return true;
      },
    },
    { key: "Mod-1", run: toggleLinePrefixCommand("# "), preventDefault: true },
    { key: "Mod-2", run: toggleLinePrefixCommand("## "), preventDefault: true },
    { key: "Mod-3", run: toggleLinePrefixCommand("### "), preventDefault: true },
    { key: "Mod-Shift-x", run: toggleMark("~~"), preventDefault: true },
    { key: "*", run: wrapWith("*") },
    { key: "_", run: wrapWith("_") },
    { key: "`", run: wrapWith("`") },
    { key: "~", run: wrapWith("~") },
  ];
}

const turndownService = new TurndownService({
  headingStyle: "atx",
  hr: "---",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
  emDelimiter: "*",
  strongDelimiter: "**",
});

function getParagraphSelection(
  doc: {
    lineAt: (pos: number) => { from: number; to: number; text: string; number: number };
    line: (number: number) => { from: number; to: number; text: string; number: number };
    lines: number;
  },
  pos: number,
) {
  const isBlankLine = (text: string) => text.trim().length === 0;
  const currentLine = doc.lineAt(pos);

  if (isBlankLine(currentLine.text)) {
    return { from: currentLine.from, to: currentLine.to };
  }

  let startLine = currentLine.number;
  let endLine = currentLine.number;

  while (startLine > 1) {
    const prevLine = doc.line(startLine - 1);
    if (isBlankLine(prevLine.text)) break;
    startLine -= 1;
  }

  while (endLine < doc.lines) {
    const nextLine = doc.line(endLine + 1);
    if (isBlankLine(nextLine.text)) break;
    endLine += 1;
  }

  return {
    from: doc.line(startLine).from,
    to: doc.line(endLine).to,
  };
}

function createDomHandlers(editable: boolean) {
  return EditorView.domEventHandlers({
    mousedown(event, view) {
      if (!editable || event.button !== 0) return false;
      const target = event.target;
      if (!(target instanceof HTMLElement)) return false;

      const lineElement = target.closest(".cm-line.cm-task-item");
      if (!(lineElement instanceof HTMLElement)) return false;

      const clickOffset = event.clientX - lineElement.getBoundingClientRect().left;
      if (clickOffset > 28) return false;

      event.preventDefault();
      event.stopPropagation();

      const lineNumber = view.state.doc.lineAt(view.posAtDOM(lineElement, 0)).number;
      return toggleTaskCheckboxOnLine(view, lineNumber);
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

    click(event, view) {
      if (event.detail !== 3) return false;

      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos === null) return false;

      const selection = getParagraphSelection(view.state.doc, pos);
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
}

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
  revealSyntaxOnActiveLine = true,
  wikilinkTargets = EMPTY_WIKILINK_TARGETS,
  onOpenWikilink,
  onCreateWikilinkMemory,
}: Props) {
  const { t } = useTranslation();
  const localRef = useRef<EditorView | null>(null);
  const linkTextPlaceholder = t("memoryEditor.toolbar.linkTextPlaceholder");
  const createMemoryLabel = t("memoryEditor.warnings.createMemory");
  const taskPriorityLabels = useMemo(
    () => ({
      high: t("memoryEditor.taskPriority.high"),
      medium: t("memoryEditor.taskPriority.medium"),
      low: t("memoryEditor.taskPriority.low"),
    }),
    [t],
  );
  const stableWikilinkTargets =
    wikilinkTargets.length > 0 ? wikilinkTargets : EMPTY_WIKILINK_TARGETS;

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
      structuralDecorations,
      ...(showSyntax ? [] : [createLivePreviewPlugin(revealSyntaxOnActiveLine, editable, taskPriorityLabels)]),
      ...(showSyntax
        ? []
        : createWikilinkExtensions({
            targets: stableWikilinkTargets,
            revealSyntaxOnActiveLine,
            onOpenMemory: onOpenWikilink,
            onCreateMemory: onCreateWikilinkMemory,
            getCreateMemoryLabel: () => createMemoryLabel,
            getCreateMemoryDetail: ({ l0, id }) => (l0 === id ? id : `${l0} · ${id}`),
          })),
      syntaxHighlighting(markdownHighlightStyle),
      history(),
      keymap.of(createMarkdownKeymap(linkTextPlaceholder)),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      createDomHandlers(editable),
    ],
    [
      themeVariant,
      showSyntax,
      editable,
      taskPriorityLabels,
      linkTextPlaceholder,
      createMemoryLabel,
      revealSyntaxOnActiveLine,
      stableWikilinkTargets,
      onOpenWikilink,
      onCreateWikilinkMemory,
    ],
  );

  return (
    <div className={clsx("h-full w-full text-[0.9375rem] leading-[1.65]", className)}>
      <CodeMirror
        value={content}
        onChange={onChange}
        onBlur={onBlur}
        editable={editable}
        placeholder={placeholder}
        extensions={extensions}
        onCreateEditor={(view) => {
          localRef.current = view;
          if (viewRef) viewRef.current = view;
        }}
        basicSetup={EDITOR_BASIC_SETUP}
      />
    </div>
  );
}
