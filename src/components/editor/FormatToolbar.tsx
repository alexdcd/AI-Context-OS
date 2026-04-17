import { useEffect, useRef, useState } from "react";
import type { EditorView } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  Link as LinkIcon,
  Image as ImageIcon,
  List,
  ListOrdered,
  ListChecks,
  Quote,
  Minus,
  Heading1,
  Heading2,
  Heading3,
  Type,
  Table as TableIcon,
} from "lucide-react";
import { clsx } from "clsx";

interface Props {
  viewRef: React.MutableRefObject<EditorView | null>;
  disabled?: boolean;
}

function wrapSelection(view: EditorView, mark: string, placeholder = "") {
  const { state } = view;
  const changes = state.changeByRange((range) => {
    const text = state.sliceDoc(range.from, range.to) || placeholder;
    const inserted = `${mark}${text}${mark}`;
    return {
      changes: [{ from: range.from, to: range.to, insert: inserted }],
      range: EditorSelection.range(range.from + mark.length, range.from + mark.length + text.length),
    };
  });
  view.dispatch(state.update(changes, { scrollIntoView: true, userEvent: "input" }));
  view.focus();
}

function toggleLinePrefix(view: EditorView, prefix: string) {
  const { state } = view;
  const changes = state.changeByRange((range) => {
    const startLine = state.doc.lineAt(range.from);
    const endLine = state.doc.lineAt(range.to);
    const changes: { from: number; to: number; insert: string }[] = [];
    for (let n = startLine.number; n <= endLine.number; n++) {
      const line = state.doc.line(n);
      const headingMatch = line.text.match(/^#{1,6}\s+/);
      const bulletMatch = line.text.match(/^(\s*)([-*+])\s+/);
      const orderedMatch = line.text.match(/^(\s*)\d+\.\s+/);
      const taskMatch = line.text.match(/^(\s*)-\s\[[ xX]\]\s+/);
      const quoteMatch = line.text.match(/^>\s?/);

      if (prefix.startsWith("#")) {
        if (headingMatch && line.text.startsWith(prefix)) {
          changes.push({ from: line.from, to: line.from + prefix.length, insert: "" });
        } else if (headingMatch) {
          changes.push({ from: line.from, to: line.from + headingMatch[0].length, insert: prefix });
        } else {
          changes.push({ from: line.from, to: line.from, insert: prefix });
        }
      } else if (prefix === "> ") {
        if (quoteMatch) {
          changes.push({ from: line.from, to: line.from + quoteMatch[0].length, insert: "" });
        } else {
          changes.push({ from: line.from, to: line.from, insert: prefix });
        }
      } else if (prefix === "- ") {
        if (taskMatch) {
          changes.push({ from: line.from, to: line.from + taskMatch[0].length, insert: prefix });
        } else if (bulletMatch) {
          changes.push({ from: line.from, to: line.from + bulletMatch[0].length, insert: "" });
        } else if (orderedMatch) {
          changes.push({ from: line.from, to: line.from + orderedMatch[0].length, insert: prefix });
        } else {
          changes.push({ from: line.from, to: line.from, insert: prefix });
        }
      } else if (prefix === "1. ") {
        if (orderedMatch) {
          changes.push({ from: line.from, to: line.from + orderedMatch[0].length, insert: "" });
        } else if (bulletMatch) {
          changes.push({ from: line.from, to: line.from + bulletMatch[0].length, insert: prefix });
        } else {
          changes.push({ from: line.from, to: line.from, insert: prefix });
        }
      } else if (prefix === "- [ ] ") {
        if (taskMatch) {
          changes.push({ from: line.from, to: line.from + taskMatch[0].length, insert: "" });
        } else if (bulletMatch) {
          changes.push({ from: line.from, to: line.from + bulletMatch[0].length, insert: prefix });
        } else {
          changes.push({ from: line.from, to: line.from, insert: prefix });
        }
      }
    }
    const delta = changes.reduce((acc, c) => acc + (c.insert.length - (c.to - c.from)), 0);
    return {
      changes,
      range: EditorSelection.range(range.from, range.to + delta),
    };
  });
  view.dispatch(state.update(changes, { scrollIntoView: true, userEvent: "input" }));
  view.focus();
}

function insertBlock(view: EditorView, text: string, cursorOffset?: number) {
  const { state } = view;
  const range = state.selection.main;
  const line = state.doc.lineAt(range.from);
  const atLineStart = range.from === line.from;
  const prefix = atLineStart ? "" : "\n";
  const insert = `${prefix}${text}`;
  const from = range.from;
  view.dispatch({
    changes: { from, to: range.to, insert },
    selection: EditorSelection.single(from + prefix.length + (cursorOffset ?? insert.length - prefix.length)),
    scrollIntoView: true,
    userEvent: "input",
  });
  view.focus();
}

function insertLink(view: EditorView) {
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
  view.focus();
}

function insertImage(view: EditorView) {
  const { state } = view;
  const range = state.selection.main;
  const insert = `![alt](url)`;
  view.dispatch({
    changes: { from: range.from, to: range.to, insert },
    selection: EditorSelection.range(range.from + 7, range.from + 10),
    scrollIntoView: true,
    userEvent: "input",
  });
  view.focus();
}

function insertTable(view: EditorView) {
  const table = `| Columna 1 | Columna 2 |\n| --- | --- |\n| a | b |\n`;
  insertBlock(view, table);
}

function insertCodeBlock(view: EditorView) {
  insertBlock(view, "```\n\n```", 4);
}

function insertHorizontalRule(view: EditorView) {
  insertBlock(view, "\n---\n");
}

interface Item {
  key: string;
  label: string;
  shortcut?: string;
  icon: React.ReactNode;
  run: (view: EditorView) => void;
}

const items: Item[] = [
  { key: "bold", label: "Negrita", shortcut: "⌘B", icon: <Bold className="h-3.5 w-3.5" />, run: (v) => wrapSelection(v, "**", "texto") },
  { key: "italic", label: "Cursiva", shortcut: "⌘I", icon: <Italic className="h-3.5 w-3.5" />, run: (v) => wrapSelection(v, "*", "texto") },
  { key: "strike", label: "Tachado", shortcut: "⌘⇧X", icon: <Strikethrough className="h-3.5 w-3.5" />, run: (v) => wrapSelection(v, "~~", "texto") },
  { key: "code", label: "Código inline", shortcut: "⌘E", icon: <Code className="h-3.5 w-3.5" />, run: (v) => wrapSelection(v, "`", "code") },
  { key: "link", label: "Enlace", shortcut: "⌘K", icon: <LinkIcon className="h-3.5 w-3.5" />, run: insertLink },
  { key: "image", label: "Imagen", icon: <ImageIcon className="h-3.5 w-3.5" />, run: insertImage },
  { key: "h1", label: "Título 1", shortcut: "⌘1", icon: <Heading1 className="h-3.5 w-3.5" />, run: (v) => toggleLinePrefix(v, "# ") },
  { key: "h2", label: "Título 2", shortcut: "⌘2", icon: <Heading2 className="h-3.5 w-3.5" />, run: (v) => toggleLinePrefix(v, "## ") },
  { key: "h3", label: "Título 3", shortcut: "⌘3", icon: <Heading3 className="h-3.5 w-3.5" />, run: (v) => toggleLinePrefix(v, "### ") },
  { key: "ul", label: "Lista", icon: <List className="h-3.5 w-3.5" />, run: (v) => toggleLinePrefix(v, "- ") },
  { key: "ol", label: "Lista numerada", icon: <ListOrdered className="h-3.5 w-3.5" />, run: (v) => toggleLinePrefix(v, "1. ") },
  { key: "task", label: "Lista de tareas", icon: <ListChecks className="h-3.5 w-3.5" />, run: (v) => toggleLinePrefix(v, "- [ ] ") },
  { key: "quote", label: "Cita", icon: <Quote className="h-3.5 w-3.5" />, run: (v) => toggleLinePrefix(v, "> ") },
  { key: "codeblock", label: "Bloque de código", icon: <Code className="h-3.5 w-3.5" />, run: insertCodeBlock },
  { key: "table", label: "Tabla", icon: <TableIcon className="h-3.5 w-3.5" />, run: insertTable },
  { key: "hr", label: "Regla horizontal", icon: <Minus className="h-3.5 w-3.5" />, run: insertHorizontalRule },
];

export function FormatToolbar({ viewRef, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("mousedown", handler);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", handler);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);

  const run = (item: Item) => {
    const view = viewRef.current;
    if (!view) return;
    item.run(view);
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative z-50">
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        disabled={disabled}
        className={clsx(
          "flex items-center gap-1 rounded p-1 text-[color:var(--text-2)] transition-colors hover:text-[color:var(--text-1)]",
          open && "bg-[color:var(--bg-2)] text-[color:var(--text-1)]",
          disabled && "opacity-50",
        )}
        title="Formato (Aa)"
      >
        <Type className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-[100] mt-1 w-64 overflow-hidden rounded-md border border-[var(--border)] bg-[color:var(--bg-1)] shadow-lg">
          {items.map((item, i) => {
            const addDivider = ["image", "h3", "task", "table"].includes(item.key);
            return (
              <div key={item.key}>
                <button
                  type="button"
                  onClick={() => run(item)}
                  className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs text-[color:var(--text-1)] transition-colors hover:bg-[color:var(--bg-2)]"
                >
                  <span className="flex h-5 w-5 items-center justify-center text-[color:var(--text-2)]">
                    {item.icon}
                  </span>
                  <span className="flex-1">{item.label}</span>
                  {item.shortcut && (
                    <span className="font-mono text-[10px] text-[color:var(--text-2)]">{item.shortcut}</span>
                  )}
                </button>
                {addDivider && i < items.length - 1 && (
                  <div className="my-0.5 border-t border-[var(--border)]" />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
