import { clsx } from "clsx";
import CodeMirror from "@uiw/react-codemirror";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { keymap } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";

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
    letterSpacing: "-0.01em",
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
  { tag: t.heading1, fontSize: "1.6em", fontWeight: "700", color: "var(--text-0)", marginTop: "1em", marginBottom: "0.5em" },
  { tag: t.heading2, fontSize: "1.4em", fontWeight: "700", color: "var(--text-0)", marginTop: "0.8em", marginBottom: "0.4em" },
  { tag: t.heading3, fontSize: "1.25em", fontWeight: "700", color: "var(--text-0)", marginTop: "0.6em", marginBottom: "0.3em" },
  { tag: t.heading4, fontSize: "1.1em", fontWeight: "700", color: "var(--text-0)" },
  { tag: t.heading5, fontSize: "1em", fontWeight: "700", color: "var(--text-0)" },
  { tag: t.heading6, fontSize: "1em", fontWeight: "700", color: "var(--text-0)" },
  { tag: t.strong, fontWeight: "bold" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: t.link, color: "var(--accent)", textDecoration: "underline" },
  { tag: t.url, color: "var(--text-2)" },
  { tag: t.monospace, fontFamily: "monospace", color: "var(--text-0)", backgroundColor: "color-mix(in srgb, var(--bg-2) 60%, transparent)", padding: "0.1em 0.3em", borderRadius: "3px", fontSize: "0.9em" },
  { tag: t.keyword, color: "var(--accent)" },
  { tag: [t.processingInstruction, t.meta, t.punctuation], color: "var(--text-2)" }, // markdown markup characters (#, **, etc)
]);

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
