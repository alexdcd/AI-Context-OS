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
import { getActivePreviewLineNumbers } from "./editorPreviewState";
import { isTaskCheckboxHitOffset } from "./editorMouseSelection";
import {
  hiddenSyntaxMark,
  shouldHideMarkdownNode,
} from "./editorLivePreview";
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
    // Use native selection
    "& ::selection": {
      backgroundColor: "rgba(124, 138, 255, 0.25) !important",
    },
    ".cm-hidden-syntax": {
      display: "none",
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
      const treeChanged = syntaxTree(update.state) !== syntaxTree(update.startState);
      if (update.docChanged || update.viewportChanged || treeChanged) {
        this.decorations = this.buildDecorations(update.view);
      }
    }

    buildDecorations(view: EditorView) {
      const decos: { from: number; to: number; deco: Decoration; isLine?: boolean }[] = [];

      const addLine = (from: number, deco: Decoration) => {
        decos.push({ from, to: from, deco, isLine: true });
      };

      for (const { from, to } of view.visibleRanges) {
        syntaxTree(view.state).iterate({
          from,
          to,
          enter: (node) => {
            if (node.name.includes("Heading")) {
              const match = node.name.match(/Heading(\d)/);
              if (match) {
                addLine(view.state.doc.lineAt(node.from).from, Decoration.line({ class: `cm-h${match[1]}` }));
              }
              return;
            }

            if (node.name === "Blockquote") {
              let line = view.state.doc.lineAt(node.from);
              const endLine = view.state.doc.lineAt(Math.max(node.from, node.to - 1));
              while (line.number <= endLine.number) {
                addLine(line.from, Decoration.line({ class: "cm-blockquote" }));
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
              const lineFrom = view.state.doc.lineAt(node.from).from;
              if (hasTaskChild) {
                addLine(lineFrom, Decoration.line({ class: "cm-task-item" }));
                addLine(lineFrom, Decoration.line({ class: `cm-list-depth-${depth}` }));
                if (taskMarker?.toLowerCase().includes("x")) {
                  addLine(lineFrom, Decoration.line({ class: "cm-task-checked" }));
                }
              } else {
                addLine(lineFrom, Decoration.line({ class: "cm-bullet-item" }));
                addLine(lineFrom, Decoration.line({ class: `cm-list-depth-${depth}` }));
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
              const lineFrom = view.state.doc.lineAt(node.from).from;
              addLine(lineFrom, Decoration.line({ class: "cm-ordered-item" }));
              addLine(lineFrom, Decoration.line({ class: `cm-list-depth-${depth}` }));
              addLine(lineFrom, Decoration.line({ attributes: { "data-list-index": markerText } }));
              return;
            }

            if (node.name === "TableHeader") {
              addLine(view.state.doc.lineAt(node.from).from, Decoration.line({ class: "cm-table-header" }));
              return;
            }

            if (node.name === "TableDelimiter") {
              const line = view.state.doc.lineAt(node.from);
              if (line.from === node.from) {
                addLine(line.from, Decoration.line({ class: "cm-table-separator" }));
              }
              return;
            }

            if (node.name === "TableRow") {
              addLine(view.state.doc.lineAt(node.from).from, Decoration.line({ class: "cm-table-row" }));
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
                addLine(line.from, Decoration.line({ class: "cm-codeblock" }));
                if (lineNumber === startLine.number) {
                  addLine(line.from, Decoration.line({ class: "cm-codeblock-start" }));
                  addLine(line.from, Decoration.line({ attributes: { "data-code-language": language || "code" } }));
                } else if (lineNumber === endLine.number) {
                  addLine(line.from, Decoration.line({ class: "cm-codeblock-end" }));
                } else {
                  addLine(line.from, Decoration.line({ class: "cm-codeblock-body" }));
                }
              }
              return;
            }

            if (node.name === "HorizontalRule") {
              addLine(view.state.doc.lineAt(node.from).from, Decoration.line({ class: "cm-hr" }));
              return;
            }

            if (node.name === "Image") {
              const raw = view.state.doc.sliceString(node.from, node.to);
              const match = raw.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
              if (match) {
                decos.push({
                  from: node.from,
                  to: node.to,
                  deco: Decoration.replace({ widget: new ImagePreviewWidget(match[1], match[2]) }),
                });
              }
            }
          },
        });
      }

      decos.sort((a, b) => {
        if (a.from !== b.from) return a.from - b.from;
        
        const aIsLine = a.isLine ? -1 : 1;
        const bIsLine = b.isLine ? -1 : 1;
        if (aIsLine !== bIsLine) return aIsLine - bIsLine;

        return a.to - b.to;
      });

      const builder = new RangeSetBuilder<Decoration>();
      for (const d of decos) {
        builder.add(d.from, d.to, d.deco);
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

function getEventTargetElement(target: EventTarget | null): HTMLElement | null {
  if (target instanceof HTMLElement) return target;
  if (target instanceof Node) {
    return target.parentElement;
  }
  return null;
}

function getLineElementAtPoint(view: EditorView, x: number, y: number) {
  const element = view.dom.ownerDocument.elementFromPoint(x, y);
  if (element instanceof HTMLElement) {
    return element.closest(".cm-line");
  }
  if (element instanceof Node) {
    return element.parentElement?.closest(".cm-line") ?? null;
  }
  return null;
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

function createLivePreviewPlugin(revealSyntaxOnActiveLine: boolean) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = this.buildDecorations(view);
      }

      update(update: ViewUpdate) {
        const treeChanged = syntaxTree(update.state) !== syntaxTree(update.startState);
        if (
          update.docChanged
          || update.viewportChanged
          || update.selectionSet
          || treeChanged
        ) {
          this.decorations = this.buildDecorations(update.view);
        }
      }

      buildDecorations(view: EditorView) {
        const builder = new RangeSetBuilder<Decoration>();
        const state = view.state;
        const activeLines = new Set(getActivePreviewLineNumbers(state, revealSyntaxOnActiveLine));

        const linkPreviewMark = Decoration.mark({ class: "cm-link-preview" });
        const decos: { from: number; to: number; deco: Decoration }[] = [];

        for (const { from, to } of view.visibleRanges) {
          syntaxTree(state).iterate({
            from,
            to,
            enter(node) {
              const line = state.doc.lineAt(node.from).number;
              const lineIsActive = activeLines.has(line);

              if (shouldHideMarkdownNode(node.name, lineIsActive)) {
                decos.push({ from: node.from, to: node.to, deco: hiddenSyntaxMark });
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

function createDomHandlers(editable: boolean) {
  return EditorView.domEventHandlers({
    mousedown(event, view) {
      if (!editable || event.button !== 0) return false;
      const target = getEventTargetElement(event.target);
      if (!target) return false;

      /* ── Task checkbox toggle ─────────────────────────── */
      const taskLineElement = target.closest(".cm-line.cm-task-item");
      if (taskLineElement instanceof HTMLElement) {
        const clickOffset = event.clientX - taskLineElement.getBoundingClientRect().left;
        if (isTaskCheckboxHitOffset(clickOffset)) {
          event.preventDefault();
          event.stopPropagation();
          const lineNumber = view.state.doc.lineAt(view.posAtDOM(taskLineElement, 0)).number;
          return toggleTaskCheckboxOnLine(view, lineNumber);
        }
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
      ...(showSyntax ? [] : [createLivePreviewPlugin(revealSyntaxOnActiveLine)]),
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
