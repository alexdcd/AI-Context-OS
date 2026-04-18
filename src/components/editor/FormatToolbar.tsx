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
import { useTranslation } from "react-i18next";

interface Props {
  viewRef: React.MutableRefObject<EditorView | null>;
  disabled?: boolean;
}

function wrapSelection(view: EditorView, mark: string, placeholder = "") {
  const { state } = view;
  const changes = state.changeByRange((range) => {
    const normalized = normalizeInlineRange(state.doc, range.from, range.to);
    const text = state.sliceDoc(normalized.from, normalized.to) || placeholder;
    const inserted = `${mark}${text}${mark}`;
    return {
      changes: [{ from: normalized.from, to: normalized.to, insert: inserted }],
      range: EditorSelection.range(
        normalized.from + mark.length,
        normalized.from + mark.length + text.length,
      ),
    };
  });
  view.dispatch(state.update(changes, { scrollIntoView: true, userEvent: "input" }));
  view.focus();
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

function insertLink(view: EditorView, textPlaceholder: string) {
  const { state } = view;
  const range = state.selection.main;
  const selected = state.sliceDoc(range.from, range.to) || textPlaceholder;
  const insert = `[${selected}](url)`;

  view.dispatch({
    changes: { from: range.from, to: range.to, insert },
    selection: EditorSelection.range(range.from + selected.length + 3, range.from + selected.length + 6),
    scrollIntoView: true,
    userEvent: "input",
  });
  view.focus();
}

function insertImage(view: EditorView, altPlaceholder: string) {
  const { state } = view;
  const range = state.selection.main;

  view.dispatch({
    changes: { from: range.from, to: range.to, insert: `![${altPlaceholder}](url)` },
    selection: EditorSelection.range(range.from + 2, range.from + 2 + altPlaceholder.length),
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

export function FormatToolbar({ viewRef, disabled = false }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const shortcutMod = useMemo(
    () => (typeof navigator !== "undefined" && /mac/i.test(navigator.platform) ? "Cmd" : "Ctrl"),
    [],
  );

  const items: Item[] = useMemo(
    () => [
      {
        key: "bold",
        label: t("memoryEditor.toolbar.bold"),
        shortcut: `${shortcutMod}+B`,
        keywords: ["bold", "strong", "negrita"],
        icon: <Bold className="h-3.5 w-3.5" />,
        run: (view) => wrapSelection(view, "**", t("memoryEditor.toolbar.textPlaceholder")),
      },
      {
        key: "italic",
        label: t("memoryEditor.toolbar.italic"),
        shortcut: `${shortcutMod}+I`,
        keywords: ["italic", "emphasis", "cursiva"],
        icon: <Type className="h-3.5 w-3.5 italic" />,
        run: (view) => wrapSelection(view, "*", t("memoryEditor.toolbar.textPlaceholder")),
      },
      {
        key: "strike",
        label: t("memoryEditor.toolbar.strikethrough"),
        shortcut: `${shortcutMod}+Shift+X`,
        keywords: ["strike", "strikethrough", "tachado"],
        icon: <Strikethrough className="h-3.5 w-3.5" />,
        run: (view) => wrapSelection(view, "~~", t("memoryEditor.toolbar.textPlaceholder")),
      },
      {
        key: "code",
        label: t("memoryEditor.toolbar.inlineCode"),
        shortcut: `${shortcutMod}+E`,
        keywords: ["code", "inline code", "codigo"],
        icon: <Code className="h-3.5 w-3.5" />,
        run: (view) => wrapSelection(view, "`", t("memoryEditor.toolbar.codePlaceholder")),
      },
      {
        key: "link",
        label: t("memoryEditor.toolbar.link"),
        shortcut: `${shortcutMod}+K`,
        keywords: ["url", "link", "enlace"],
        icon: <LinkIcon className="h-3.5 w-3.5" />,
        run: (view) => insertLink(view, t("memoryEditor.toolbar.linkTextPlaceholder")),
      },
      {
        key: "image",
        label: t("memoryEditor.toolbar.image"),
        keywords: ["image", "alt", "imagen"],
        icon: <ImageIcon className="h-3.5 w-3.5" />,
        run: (view) => insertImage(view, t("memoryEditor.toolbar.altPlaceholder")),
      },
      {
        key: "h1",
        label: t("memoryEditor.toolbar.heading1"),
        shortcut: `${shortcutMod}+1`,
        keywords: ["h1", "heading", "title", "titulo"],
        icon: <Heading1 className="h-3.5 w-3.5" />,
        run: (view) => toggleLinePrefix(view, "# "),
      },
      {
        key: "h2",
        label: t("memoryEditor.toolbar.heading2"),
        shortcut: `${shortcutMod}+2`,
        keywords: ["h2", "heading", "subtitle", "subtitulo"],
        icon: <Heading2 className="h-3.5 w-3.5" />,
        run: (view) => toggleLinePrefix(view, "## "),
      },
      {
        key: "h3",
        label: t("memoryEditor.toolbar.heading3"),
        shortcut: `${shortcutMod}+3`,
        keywords: ["h3", "heading"],
        icon: <Heading3 className="h-3.5 w-3.5" />,
        run: (view) => toggleLinePrefix(view, "### "),
      },
      {
        key: "ul",
        label: t("memoryEditor.toolbar.bulletList"),
        keywords: ["unordered", "bullet", "list", "lista"],
        icon: <List className="h-3.5 w-3.5" />,
        run: (view) => toggleLinePrefix(view, "- "),
      },
      {
        key: "ol",
        label: t("memoryEditor.toolbar.numberedList"),
        keywords: ["ordered", "numbered", "list", "lista"],
        icon: <ListOrdered className="h-3.5 w-3.5" />,
        run: (view) => toggleLinePrefix(view, "1. "),
      },
      {
        key: "task",
        label: t("memoryEditor.toolbar.taskList"),
        keywords: ["task", "checkbox", "todo", "checklist"],
        icon: <ListChecks className="h-3.5 w-3.5" />,
        run: (view) => toggleLinePrefix(view, "- [ ] "),
      },
      {
        key: "quote",
        label: t("memoryEditor.toolbar.quote"),
        keywords: ["quote", "blockquote", "cita"],
        icon: <Quote className="h-3.5 w-3.5" />,
        run: (view) => toggleLinePrefix(view, "> "),
      },
      {
        key: "codeblock",
        label: t("memoryEditor.toolbar.codeBlock"),
        keywords: ["snippet", "fenced", "code block", "bloque"],
        icon: <Code className="h-3.5 w-3.5" />,
        run: (view) => insertBlock(view, "```\n\n```", 4),
      },
      {
        key: "hr",
        label: t("memoryEditor.toolbar.divider"),
        keywords: ["divider", "horizontal rule", "separator", "separador"],
        icon: <Minus className="h-3.5 w-3.5" />,
        run: (view) => insertBlock(view, "---\n"),
      },
    ],
    [shortcutMod, t],
  );

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
        title={t("memoryEditor.toolbar.title")}
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
                placeholder={t("memoryEditor.toolbar.searchPlaceholder")}
                className="w-full bg-transparent text-sm text-[color:var(--text-0)] placeholder:text-[color:var(--text-2)] focus:outline-none"
              />
            </div>
          </div>

          <div className="max-h-80 overflow-y-auto p-1.5">
            {filteredItems.length === 0 ? (
              <div className="px-3 py-6 text-center text-sm text-[color:var(--text-2)]">
                {t("memoryEditor.toolbar.noResults")}
              </div>
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
