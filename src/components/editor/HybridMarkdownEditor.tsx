import { clsx } from "clsx";
import CodeMirror from "@uiw/react-codemirror";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { keymap, KeyBinding } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { StateCommand, EditorSelection } from "@codemirror/state";

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
    syntaxHighlighting(markdownHighlightStyle),
    history(),
    keymap.of(markdownKeymap),
    keymap.of([...defaultKeymap, ...historyKeymap]),
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
