import { clsx } from "clsx";
import TurndownService from "turndown";
import CodeMirror from "@uiw/react-codemirror";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { EditorView, keymap, KeyBinding, ViewPlugin, Decoration, DecorationSet, ViewUpdate } from "@codemirror/view";
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
  { tag: t.link, color: "var(--accent)", textDecoration: "underline" },
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

const pasteHandler = EditorView.domEventHandlers({
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
    syntaxHighlighting(markdownHighlightStyle),
    history(),
    keymap.of(markdownKeymap),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    pasteHandler,
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
