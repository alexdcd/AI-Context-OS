import { clsx } from "clsx";
import TurndownService from "turndown";
import { open } from "@tauri-apps/plugin-shell";
import CodeMirror from "@uiw/react-codemirror";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { EditorView, keymap, KeyBinding, ViewPlugin, Decoration, DecorationSet, ViewUpdate, WidgetType } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import { HighlightStyle, syntaxHighlighting, syntaxTree } from "@codemirror/language";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { StateCommand, EditorSelection, RangeSetBuilder } from "@codemirror/state";

interface Props {
  content: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  className?: string;
  editable?: boolean;
}

// Custom theme to blend exactly with the app's dark/light modes
const customTheme = EditorView.theme({
  "&": {
    backgroundColor: "transparent !important",
    color: "var(--text-0)",
    fontSize: "0.9375rem",
    lineHeight: "1.65",
  },
  ".cm-content": {
    padding: "0",
    caretColor: "var(--text-0)",
  },
  "&.cm-focused": {
    outline: "none",
  },
  ".cm-gutters": {
    display: "none", // No line numbers
  },
  ".cm-line": {
    padding: "0",
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
  ".cm-line.cm-h1": { fontSize: "1.6em", fontWeight: "700", paddingTop: "0.5em", paddingBottom: "0.2em" },
  ".cm-line.cm-h2": { fontSize: "1.4em", fontWeight: "700", paddingTop: "0.4em", paddingBottom: "0.2em" },
  ".cm-line.cm-h3": { fontSize: "1.25em", fontWeight: "700", paddingTop: "0.3em", paddingBottom: "0.2em" },
  ".cm-line.cm-h4": { fontSize: "1.1em", fontWeight: "700" },
  ".cm-line.cm-h5": { fontSize: "1em", fontWeight: "700" },
  ".cm-line.cm-h6": { fontSize: "1em", fontWeight: "700", color: "var(--text-2)" },
});

// A custom highlighting style to mimic Obsidian's markdown highlight 
// (e.g. bold is bold, headings are larger, but it's still text)
const markdownHighlightStyle = HighlightStyle.define([
  { tag: t.heading1, fontWeight: "700", color: "var(--text-0)" },
  { tag: t.heading2, fontWeight: "700", color: "var(--text-0)" },
  { tag: t.heading3, fontWeight: "700", color: "var(--text-0)" },
  { tag: t.heading4, fontWeight: "700", color: "var(--text-0)" },
  { tag: t.heading5, fontWeight: "700", color: "var(--text-0)" },
  { tag: t.heading6, fontWeight: "700", color: "var(--text-0)" },
  { tag: t.strong, fontWeight: "bold" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: t.link, color: "var(--accent)", textDecoration: "underline", cursor: "pointer" },
  { tag: t.url, color: "var(--text-2)" },
  { tag: t.monospace, fontFamily: "monospace", color: "var(--text-0)", backgroundColor: "color-mix(in srgb, var(--bg-2) 60%, transparent)", borderRadius: "3px" },
  { tag: t.keyword, color: "var(--accent)" },
  { tag: [t.processingInstruction, t.meta, t.punctuation], color: "var(--text-2)" }, // markdown markup characters (#, **, etc)
]);

// Decorates entire lines based on syntax tree (needed for font-size changes)
const headingDecorations = ViewPlugin.fromClass(class {
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
    for (const {from, to} of view.visibleRanges) {
      syntaxTree(view.state).iterate({
        from, to,
        enter(node) {
          if (node.name.includes("Heading")) {
            const match = node.name.match(/Heading(\d)/);
            if (match) {
              const level = match[1];
              // Add a class to the entire line
              builder.add(node.from, node.from, Decoration.line({
                class: `cm-h${level}`
              }));
            }
          }
        }
      });
    }
    return builder.finish();
  }
}, {
  decorations: v => v.decorations
});

// Live Preview: Hides markdown markers unless cursor is on that line
class LinkIconWidget extends WidgetType {
  constructor(public url: string) { super(); }
  
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-link-icon";
    span.style.display = "inline-flex";
    span.style.alignItems = "center";
    span.style.marginLeft = "4px";
    span.style.color = "var(--text-2)";
    span.style.cursor = "pointer";
    span.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>`;
    
    span.addEventListener("click", (e) => {
      open(this.url).catch(console.error);
      e.preventDefault();
      e.stopPropagation();
    });
    
    return span;
  }
}

const livePreviewPlugin = ViewPlugin.fromClass(class {
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
    const decos: {from: number, to: number, deco: Decoration}[] = [];

    for (const {from, to} of view.visibleRanges) {
      syntaxTree(state).iterate({
        from, to,
        enter(node) {
          const isHiddenMarker = [
            "HeaderMark",
            "EmphasisMark",
            "StrongEmphasisMark",
            "StrikethroughMark",
            "CodeMark",
            "LinkMark"
          ].includes(node.name);

          const line = state.doc.lineAt(node.from).number;
          if (!activeLines.has(line)) {
            if (isHiddenMarker) {
              decos.push({from: node.from, to: node.to, deco: hideDeco});
            } else if (node.name === "URL" && node.node.parent?.name === "Link") {
              const urlText = state.sliceDoc(node.from, node.to).replace(/^[\(\<]/, '').replace(/[\)\>]$/, '');
              decos.push({
                from: node.from, 
                to: node.to, 
                deco: Decoration.replace({ widget: new LinkIconWidget(urlText) }) 
              });
            }
          }
        }
      });
    }
    
    decos.sort((a, b) => a.from - b.from || a.to - b.to);
    for (const d of decos) {
      builder.add(d.from, d.to, d.deco);
    }

    return builder.finish();
  }
}, {
  decorations: v => v.decorations
});

// Helper to toggle a formatting string around the selection
function toggleMark(mark: string): StateCommand {
  return ({ state, dispatch }) => {
    const changes = state.changeByRange((range) => {
      // If empty selection, assume we want to just insert formatting marks and put cursor inside
      if (range.empty) {
        const isInside = 
          range.from >= mark.length &&
          range.to <= state.doc.length - mark.length &&
          state.sliceDoc(range.from - mark.length, range.from) === mark &&
          state.sliceDoc(range.to, range.to + mark.length) === mark;

        if (isInside) {
          // just move cursor past the mark
          return {
            range: EditorSelection.range(range.anchor + mark.length, range.head + mark.length),
          };
        } else {
          return {
            changes: [{ from: range.from, insert: mark + mark }],
            range: EditorSelection.range(range.anchor + mark.length, range.head + mark.length),
          };
        }
      }
      
      const isMarked = 
        range.from >= mark.length &&
        range.to <= state.doc.length - mark.length &&
        state.sliceDoc(range.from - mark.length, range.from) === mark &&
        state.sliceDoc(range.to, range.to + mark.length) === mark;

      if (isMarked) {
        return {
          changes: [
            { from: range.from - mark.length, to: range.from },
            { from: range.to, to: range.to + mark.length },
          ],
          range: EditorSelection.range(range.anchor - mark.length, range.head - mark.length),
        };
      } else {
        return {
          changes: [
            { from: range.from, insert: mark },
            { from: range.to, insert: mark },
          ],
          range: EditorSelection.range(range.anchor + mark.length, range.head + mark.length),
        };
      }
    });

    dispatch(state.update(changes, { scrollIntoView: true, userEvent: "input" }));
    return true;
  };
}

// Helper to wrap the selection when typing characters like '*', '_', '`'
function wrapWith(mark: string): StateCommand {
  return ({ state, dispatch }) => {
    // Only intercept if we have at least one non-empty selection
    if (state.selection.ranges.every(r => r.empty)) return false;

    const changes = state.changeByRange((range) => {
      if (range.empty) return { range };
      
      return {
        changes: [
          { from: range.from, insert: mark },
          { from: range.to, insert: mark },
        ],
        range: EditorSelection.range(range.anchor + mark.length, range.head + mark.length),
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
  strongDelimiter: "**"
});

const domHandlers = EditorView.domEventHandlers({
  paste(event, view) {
    const data = event.clipboardData;
    if (!data) return false;

    // Preserve VSCode plain-text formatting (avoid treating colored spans as markdown noise)
    if (data.getData("vscode-editor-data") || data.getData("text/plain").includes("```")) {
      return false;
    }

    const html = data.getData("text/html");
    if (!html) return false;

    try {
      const parsedMarkdown = turndownService.turndown(html);
      if (!parsedMarkdown) return false;

      const changes = view.state.changeByRange((range) => {
        return {
          changes: [{ from: range.from, to: range.to, insert: parsedMarkdown }],
          range: EditorSelection.range(range.from + parsedMarkdown.length, range.from + parsedMarkdown.length)
        };
      });

      view.dispatch(
        view.state.update(changes, { scrollIntoView: true, userEvent: "input.paste" })
      );

      event.preventDefault();
      return true;
    } catch (err) {
      console.error("Paste Turndown Error:", err);
      return false;
    }
  },
  
  click(event, view) {
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos === null) return false;

    let node = syntaxTree(view.state).resolveInner(pos, 1);
    
    let urlNode = null;
    let curr: typeof node | null = node;
    while (curr && curr.name !== "Document") {
      if (curr.name === "URL") {
        urlNode = curr;
        break;
      }
      if (curr.name === "Link") {
        let child = curr.firstChild;
        while (child) {
          if (child.name === "URL") {
            urlNode = child;
            break;
          }
          child = child.nextSibling;
        }
        break;
      }
      curr = curr.parent;
    }

    if (urlNode) {
      let urlText = view.state.sliceDoc(urlNode.from, urlNode.to);
      urlText = urlText.replace(/^[\(\<]/, '').replace(/[\)\>]$/, '');
      
      // Open if they click directly on the URL string, or Cmd/Ctrl+Click anywhere on the Link
      if (event.metaKey || event.ctrlKey || node.name === "URL") {
        open(urlText).catch(e => console.error("Failed to open URL:", e));
        event.preventDefault();
        return true;
      }
    }
    return false;
  }
});

/**
 * Obsidian-like CodeMirror 6 markdown editor.
 */
export function HybridMarkdownEditor({
  content,
  onChange,
  onBlur,
  placeholder,
  className,
  editable = true,
}: Props) {
  const extensions = [
    markdown({ base: markdownLanguage, codeLanguages: languages }),
    EditorView.lineWrapping,
    customTheme,
    headingDecorations,
    livePreviewPlugin,
    syntaxHighlighting(markdownHighlightStyle),
    history(),
    keymap.of(markdownKeymap),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    domHandlers,
  ];

  return (
    <div className={clsx("w-full h-full text-[0.9375rem] leading-[1.65]", className)}>
      <CodeMirror
        value={content}
        onChange={(val) => onChange(val)}
        onBlur={onBlur}
        editable={editable}
        placeholder={placeholder}
        extensions={extensions}
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
        }}
      />
    </div>
  );
}
