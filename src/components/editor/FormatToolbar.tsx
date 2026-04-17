import { useEffect, useMemo, useRef, useState } from "react";
import type { EditorView } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";
import {
  Bold,
  ChevronDown,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Image as ImageIcon,
  Link as LinkIcon,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Quote,
  Search,
  Strikethrough,
  Type,
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
    const nextChanges: { from: number; to: number; insert: string }[] = [];

    for (let lineNumber = startLine.number; lineNumber <= endLine.number; lineNumber += 1) {
      const line = state.doc.line(lineNumber);
      const headingMatch = line.text.match(/^#{1,6}\s+/);
      const bulletMatch = line.text.match(/^(\s*)([-*+])\s+/);
      const orderedMatch = line.text.match(/^(\s*)\d+\.\s+/);
      const taskMatch = line.text.match(/^(\s*)-\s\[[ xX]\]\s+/);
      const quoteMatch = line.text.match(/^>\s?/);

      if (prefix.startsWith("#")) {
        if (headingMatch && line.text.startsWith(prefix)) {
          nextChanges.push({ from: line.from, to: line.from + prefix.length, insert: "" });
        } else if (headingMatch) {
          nextChanges.push({ from: line.from, to: line.from + headingMatch[0].length, insert: prefix });
        } else {
          nextChanges.push({ from: line.from, to: line.from, insert: prefix });
        }
        continue;
      }

      if (prefix === "> ") {
        if (quoteMatch) {
          nextChanges.push({ from: line.from, to: line.from + quoteMatch[0].length, insert: "" });
        } else {
          nextChanges.push({ from: line.from, to: line.from, insert: prefix });
        }
        continue;
      }

      if (prefix === "- ") {
        if (taskMatch) {
          nextChanges.push({ from: line.from, to: line.from + taskMatch[0].length, insert: prefix });
        } else if (bulletMatch) {
          nextChanges.push({ from: line.from, to: line.from + bulletMatch[0].length, insert: "" });
        } else if (orderedMatch) {
          nextChanges.push({ from: line.from, to: line.from + orderedMatch[0].length, insert: prefix });
        } else {
          nextChanges.push({ from: line.from, to: line.from, insert: prefix });
        }
        continue;
      }

      if (prefix === "1. ") {
        if (orderedMatch) {
          nextChanges.push({ from: line.from, to: line.from + orderedMatch[0].length, insert: "" });
        } else if (bulletMatch) {
          nextChanges.push({ from: line.from, to: line.from + bulletMatch[0].length, insert: prefix });
        } else {
          nextChanges.push({ from: line.from, to: line.from, insert: prefix });
        }
        continue;
      }

      if (prefix === "- [ ] ") {
        if (taskMatch) {
          nextChanges.push({ from: line.from, to: line.from + taskMatch[0].length, insert: "" });
        } else if (bulletMatch) {
          nextChanges.push({ from: line.from, to: line.from + bulletMatch[0].length, insert: prefix });
        } else {
          nextChanges.push({ from: line.from, to: line.from, insert: prefix });
        }
      }
    }

    const delta = nextChanges.reduce((acc, change) => acc + (change.insert.length - (change.to - change.from)), 0);
    return {
      changes: nextChanges,
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
  const prefix = range.from === line.from ? "" : "\n";
  const insert = `${prefix}${text}`;

  view.dispatch({
    changes: { from: range.from, to: range.to, insert },
    selection: EditorSelection.single(range.from + prefix.length + (cursorOffset ?? insert.length - prefix.length)),
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

  view.dispatch({
    changes: { from: range.from, to: range.to, insert: "![alt](url)" },
    selection: EditorSelection.range(range.from + 7, range.from + 10),
    scrollIntoView: true,
    userEvent: "input",
  });
  view.focus();
}

type Item = {
  key: string;
  label: string;
  shortcut?: string;
  icon: React.ReactNode;
  keywords?: string[];
  run: (view: EditorView) => void;
};

const items: Item[] = [
  { key: "bold", label: "Negrita", shortcut: "Cmd+B", keywords: ["bold"], icon: <Bold className="h-3.5 w-3.5" />, run: (view) => wrapSelection(view, "**", "texto") },
  { key: "italic", label: "Cursiva", shortcut: "Cmd+I", keywords: ["italic"], icon: <Type className="h-3.5 w-3.5 italic" />, run: (view) => wrapSelection(view, "*", "texto") },
  { key: "strike", label: "Tachado", shortcut: "Cmd+Shift+X", keywords: ["strike"], icon: <Strikethrough className="h-3.5 w-3.5" />, run: (view) => wrapSelection(view, "~~", "texto") },
  { key: "code", label: "Codigo inline", shortcut: "Cmd+E", keywords: ["code"], icon: <Code className="h-3.5 w-3.5" />, run: (view) => wrapSelection(view, "`", "codigo") },
  { key: "link", label: "Enlace", shortcut: "Cmd+K", keywords: ["url", "link"], icon: <LinkIcon className="h-3.5 w-3.5" />, run: insertLink },
  { key: "image", label: "Imagen", keywords: ["image"], icon: <ImageIcon className="h-3.5 w-3.5" />, run: insertImage },
  { key: "h1", label: "Heading 1", shortcut: "Cmd+1", keywords: ["h1", "titulo"], icon: <Heading1 className="h-3.5 w-3.5" />, run: (view) => toggleLinePrefix(view, "# ") },
  { key: "h2", label: "Heading 2", shortcut: "Cmd+2", keywords: ["h2", "subtitulo"], icon: <Heading2 className="h-3.5 w-3.5" />, run: (view) => toggleLinePrefix(view, "## ") },
  { key: "h3", label: "Heading 3", shortcut: "Cmd+3", keywords: ["h3"], icon: <Heading3 className="h-3.5 w-3.5" />, run: (view) => toggleLinePrefix(view, "### ") },
  { key: "ul", label: "Lista", keywords: ["unordered", "bullet"], icon: <List className="h-3.5 w-3.5" />, run: (view) => toggleLinePrefix(view, "- ") },
  { key: "ol", label: "Lista numerada", keywords: ["ordered", "numbered"], icon: <ListOrdered className="h-3.5 w-3.5" />, run: (view) => toggleLinePrefix(view, "1. ") },
  { key: "task", label: "Lista de tareas", keywords: ["task", "checkbox"], icon: <ListChecks className="h-3.5 w-3.5" />, run: (view) => toggleLinePrefix(view, "- [ ] ") },
  { key: "quote", label: "Cita", keywords: ["quote", "blockquote"], icon: <Quote className="h-3.5 w-3.5" />, run: (view) => toggleLinePrefix(view, "> ") },
  { key: "codeblock", label: "Bloque de codigo", keywords: ["snippet", "fenced"], icon: <Code className="h-3.5 w-3.5" />, run: (view) => insertBlock(view, "```\n\n```", 4) },
  { key: "hr", label: "Separador", keywords: ["divider", "horizontal"], icon: <Minus className="h-3.5 w-3.5" />, run: (view) => insertBlock(view, "---\n") },
];

export function FormatToolbar({ viewRef, disabled = false }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target)) return;
      setOpen(false);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const filteredItems = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return items;
    return items.filter((item) =>
      [item.label, item.shortcut, ...(item.keywords ?? [])]
        .filter(Boolean)
        .some((value) => value?.toLowerCase().includes(normalized)),
    );
  }, [query]);

  const run = (item: Item) => {
    const view = viewRef.current;
    if (!view) return;
    item.run(view);
    setOpen(false);
    setQuery("");
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setOpen((value) => !value)}
        className={clsx(
          "flex items-center gap-1 rounded-md border border-[var(--border)] bg-[color:var(--bg-1)] px-2 py-1 text-xs font-medium text-[color:var(--text-1)] transition-colors hover:bg-[color:var(--bg-2)] hover:text-[color:var(--text-0)] disabled:opacity-50",
          open && "bg-[color:var(--bg-2)] text-[color:var(--text-0)]",
        )}
        title="Formato Markdown"
      >
        <span>Aa</span>
        <ChevronDown className={clsx("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="absolute right-0 top-[calc(100%+0.4rem)] z-[80] w-72 overflow-hidden rounded-xl border border-[var(--border)] bg-[color:var(--bg-1)] shadow-2xl">
          <div className="border-b border-[var(--border)] p-2">
            <div className="flex items-center gap-2 rounded-md border border-[var(--border)] bg-[color:var(--bg-0)] px-2 py-1.5">
              <Search className="h-3.5 w-3.5 text-[color:var(--text-2)]" />
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar formato"
                className="w-full bg-transparent text-sm text-[color:var(--text-0)] placeholder:text-[color:var(--text-2)] focus:outline-none"
              />
            </div>
          </div>

          <div className="max-h-80 overflow-y-auto p-1.5">
            {filteredItems.length === 0 ? (
              <div className="px-3 py-6 text-center text-sm text-[color:var(--text-2)]">No hay resultados.</div>
            ) : (
              filteredItems.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => run(item)}
                  className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm text-[color:var(--text-1)] transition-colors hover:bg-[color:var(--bg-2)] hover:text-[color:var(--text-0)]"
                >
                  <span className="flex h-7 w-7 items-center justify-center rounded-md border border-[var(--border)] bg-[color:var(--bg-0)] text-[color:var(--text-2)]">
                    {item.icon}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  <span className="font-mono text-[10px] text-[color:var(--text-2)]">{item.shortcut ?? ""}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
