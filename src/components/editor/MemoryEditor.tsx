import { useState, useEffect, useCallback, useMemo, useRef, type ReactNode } from "react";
import { FileText, PanelRightClose, PanelRightOpen, Save, Trash2, ChevronRight } from "lucide-react";
import { clsx } from "clsx";
import { useAppStore } from "../../lib/store";
import { FrontmatterForm } from "./FrontmatterForm";
import { TipTapEditor } from "./TipTapEditor";
import type { MemoryMeta, MemoryType, RawFileDocument } from "../../lib/types";

type InspectorTab = "properties" | "links" | "history";

interface OutgoingLink {
  id: string;
  kinds: string[];
}

interface IncomingLink {
  id: string;
  l0: string;
  memoryType: MemoryType;
  kinds: string[];
}

export function MemoryEditor() {
  const {
    activeMemory,
    activeRawFile,
    saveActiveMemory,
    saveRawFile,
    deleteMemory,
    loading,
    memories,
    selectFile,
    setError,
  } = useAppStore();
  const [meta, setMeta] = useState<MemoryMeta | null>(null);
  const [l1, setL1] = useState("");
  const [l2, setL2] = useState("");
  const [dirty, setDirty] = useState(false);
  const [showInspector, setShowInspector] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("properties");
  const [l1Open, setL1Open] = useState(false);

  useEffect(() => {
    if (activeMemory) {
      setMeta(activeMemory.meta);
      setL1(activeMemory.l1_content);
      setL2(activeMemory.l2_content);
      setDirty(false);
      setInspectorTab("properties");
    }
  }, [activeMemory]);

  const handleMetaChange = (updated: MemoryMeta) => {
    setMeta(updated);
    setDirty(true);
  };

  const handleSave = useCallback(async () => {
    if (meta && dirty) {
      await saveActiveMemory(l1, l2, meta);
      setDirty(false);
    }
  }, [meta, l1, l2, dirty, saveActiveMemory]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        void handleSave();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "\\") {
        e.preventDefault();
        setShowInspector((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleSave]);

  const handleDelete = useCallback(async () => {
    if (!meta) return;
    const ok = window.confirm(
      `Delete memory "${meta.id}"?\n\nThis will permanently remove the file.`,
    );
    if (!ok) return;
    await deleteMemory(meta.id);
  }, [deleteMemory, meta]);

  const outgoingLinks = useMemo<OutgoingLink[]>(() => {
    if (!meta) return [];

    const linksById = new Map<string, Set<string>>();
    const pushLink = (id: string, kind: string) => {
      if (!id) return;
      if (!linksById.has(id)) {
        linksById.set(id, new Set());
      }
      linksById.get(id)?.add(kind);
    };

    meta.related.forEach((id) => pushLink(id, "related"));
    meta.requires.forEach((id) => pushLink(id, "requires"));
    meta.optional.forEach((id) => pushLink(id, "optional"));

    return Array.from(linksById.entries())
      .map(([id, kinds]) => ({ id, kinds: Array.from(kinds) }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }, [meta]);

  const incomingLinks = useMemo<IncomingLink[]>(() => {
    if (!meta) return [];
    const targetId = meta.id;
    const results: IncomingLink[] = [];

    for (const item of memories) {
      if (item.id === targetId) continue;
      const kinds: string[] = [];
      if (item.related.includes(targetId)) kinds.push("related");
      if (item.requires.includes(targetId)) kinds.push("requires");
      if (item.optional.includes(targetId)) kinds.push("optional");
      if (kinds.length === 0) continue;

      results.push({
        id: item.id,
        l0: item.l0,
        memoryType: item.memory_type,
        kinds,
      });
    }

    return results.sort((a, b) => a.id.localeCompare(b.id));
  }, [memories, meta]);

  const historyEntries = useMemo(() => {
    if (!meta) return [] as Array<{ label: string; value: string }>;
    return [
      { label: "Created", value: formatTimestamp(meta.created) },
      { label: "Modified", value: formatTimestamp(meta.modified) },
      { label: "Last access", value: formatTimestamp(meta.last_access) },
      { label: "Version", value: `v${meta.version}` },
      { label: "Access count", value: String(meta.access_count) },
    ];
  }, [meta]);

  const handleOpenMemory = useCallback(
    async (id: string) => {
      try {
        await selectFile(id);
      } catch (e) {
        setError(`No se pudo abrir memoria ${id}: ${String(e)}`);
      }
    },
    [selectFile, setError],
  );

  if (!activeMemory || !meta) {
    if (activeRawFile) {
      return (
        <RawFileEditor
          file={activeRawFile}
          loading={loading}
          onSave={saveRawFile}
        />
      );
    }

    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-[color:var(--text-2)]">
        <FileText className="h-8 w-8 text-[color:var(--text-2)]" />
        <p className="text-sm text-[color:var(--text-1)]">Select a memory to edit</p>
        <p className="max-w-sm text-xs">
          Use the sidebar to open a note.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Minimal top bar — actions only */}
      <div className="flex items-center gap-1.5 border-b border-[var(--border)] px-4 py-1.5">
        <span className="flex-1 font-mono text-[11px] text-[color:var(--text-2)]">{meta.id}.md</span>
        <button
          type="button"
          onClick={() => setShowInspector((prev) => !prev)}
          className="rounded p-1 text-[color:var(--text-2)] transition-colors hover:text-[color:var(--text-1)]"
          title={showInspector ? "Hide inspector" : "Show inspector"}
        >
          {showInspector ? <PanelRightClose className="h-3.5 w-3.5" /> : <PanelRightOpen className="h-3.5 w-3.5" />}
        </button>
        <button
          type="button"
          onClick={handleDelete}
          disabled={loading}
          className="rounded p-1 text-[color:var(--text-2)] transition-colors hover:text-[color:var(--danger)] disabled:opacity-50"
          title="Delete memory"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={!dirty || loading}
          className={clsx(
            "inline-flex items-center gap-1 rounded-md px-2.5 py-0.5 text-[11px] font-medium transition-all",
            dirty
              ? "bg-[color:var(--accent)] text-white hover:opacity-90"
              : "text-[color:var(--text-2)]",
          )}
        >
          <Save className="h-3 w-3" />
          {dirty ? "Save" : "Saved"}
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Main editor area */}
        <div className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[780px] px-8 py-6">
            {/* Editable title (L0) */}
            <input
              type="text"
              value={meta.l0}
              onChange={(e) => {
                handleMetaChange({ ...meta, l0: e.target.value });
              }}
              placeholder="Untitled"
              className="mb-1 w-full bg-transparent text-2xl font-semibold text-[color:var(--text-0)] placeholder:text-[color:var(--text-2)]/40 focus:outline-none"
            />
            <p className="mb-6 font-mono text-[11px] text-[color:var(--text-2)]">
              {meta.memory_type}
              {meta.importance >= 0.7 ? " · high" : meta.importance >= 0.4 ? "" : " · low"}
              {meta.always_load && " · pinned"}
              {meta.tags.length > 0 && ` · ${meta.tags.join(", ")}`}
              {" · "}L2 content · v{meta.version}
            </p>

            {/* L2 — Main content */}
            <TipTapEditor
              content={l2}
              onChange={(val) => {
                setL2(val);
                setDirty(true);
              }}
              className="min-h-[400px]"
              placeholder="Write here..."
            />

            {/* L1 — Collapsible summary */}
            <div className="mt-8 border-t border-[var(--border)] pt-3">
              <button
                type="button"
                onClick={() => setL1Open((prev) => !prev)}
                className="flex items-center gap-1.5 text-[11px] font-medium text-[color:var(--text-2)] transition-colors hover:text-[color:var(--text-1)]"
              >
                <ChevronRight
                  className={clsx(
                    "h-3 w-3 transition-transform",
                    l1Open && "rotate-90",
                  )}
                />
                L1 · Expanded Summary
              </button>
              {l1Open && (
                <div className="mt-2">
                  <TipTapEditor
                    content={l1}
                    onChange={(val) => {
                      setL1(val);
                      setDirty(true);
                    }}
                    className="min-h-[120px]"
                    placeholder="L1 summary (150-300 tokens)..."
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Inspector sidebar */}
        <aside
          className={clsx(
            "obs-inspector min-h-0",
            showInspector ? "w-[320px] opacity-100" : "pointer-events-none w-0 opacity-0",
          )}
        >
          <div className="flex h-full min-h-0 flex-col overflow-hidden border-l border-[var(--border)] bg-[color:var(--bg-0)]">
            <div className="flex items-center gap-1 border-b border-[var(--border)] px-2 py-1.5">
              <InspectorTabButton
                active={inspectorTab === "properties"}
                label="Properties"
                onClick={() => setInspectorTab("properties")}
              />
              <InspectorTabButton
                active={inspectorTab === "links"}
                label="Links"
                onClick={() => setInspectorTab("links")}
              />
              <InspectorTabButton
                active={inspectorTab === "history"}
                label="History"
                onClick={() => setInspectorTab("history")}
              />
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {inspectorTab === "properties" && (
                <FrontmatterForm meta={meta} onChange={handleMetaChange} />
              )}
              {inspectorTab === "links" && (
                <LinksPanel
                  outgoing={outgoingLinks}
                  incoming={incomingLinks}
                  onOpenMemory={handleOpenMemory}
                />
              )}
              {inspectorTab === "history" && (
                <HistoryPanel history={historyEntries} dirty={dirty} />
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function InspectorTabButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "rounded px-2 py-1 text-[11px] font-medium transition-colors",
        active
          ? "bg-[color:var(--bg-2)] text-[color:var(--text-0)]"
          : "text-[color:var(--text-2)] hover:text-[color:var(--text-1)]",
      )}
    >
      {label}
    </button>
  );
}

function LinksPanel({
  outgoing,
  incoming,
  onOpenMemory,
}: {
  outgoing: OutgoingLink[];
  incoming: IncomingLink[];
  onOpenMemory: (id: string) => void;
}) {
  return (
    <div className="space-y-3 p-3">
      <LinkGroup title="Outgoing" links={outgoing} onOpenMemory={onOpenMemory} />
      <div className="space-y-2">
        <p className="text-[10px] uppercase tracking-[0.12em] text-[color:var(--text-2)]">
          Incoming
        </p>
        {incoming.length === 0 && (
          <p className="rounded-md border border-[var(--border)] bg-[color:var(--bg-2)] px-2.5 py-2 text-xs text-[color:var(--text-2)]">
            No backlinks.
          </p>
        )}
        {incoming.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onOpenMemory(item.id)}
            className="w-full rounded-md border border-[var(--border)] bg-[color:var(--bg-2)] px-2.5 py-2 text-left transition-colors hover:bg-[color:var(--bg-3)]"
          >
            <p className="truncate text-xs font-semibold text-[color:var(--text-0)]">{item.id}</p>
            <p className="mt-0.5 truncate text-[11px] text-[color:var(--text-2)]">{item.l0}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              <span className="rounded bg-[color:var(--bg-3)] px-1.5 py-0.5 text-[10px] text-[color:var(--text-2)]">
                {item.memoryType}
              </span>
              {item.kinds.map((kind) => (
                <span
                  key={`${item.id}-${kind}`}
                  className="rounded bg-[color:var(--bg-3)] px-1.5 py-0.5 text-[10px] text-[color:var(--text-2)]"
                >
                  {kind}
                </span>
              ))}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function LinkGroup({
  title,
  links,
  onOpenMemory,
}: {
  title: string;
  links: OutgoingLink[];
  onOpenMemory: (id: string) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-[10px] uppercase tracking-[0.12em] text-[color:var(--text-2)]">{title}</p>
      {links.length === 0 && (
        <p className="rounded-md border border-[var(--border)] bg-[color:var(--bg-2)] px-2.5 py-2 text-xs text-[color:var(--text-2)]">
          No links.
        </p>
      )}
      {links.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onOpenMemory(item.id)}
          className="w-full rounded-md border border-[var(--border)] bg-[color:var(--bg-2)] px-2.5 py-2 text-left transition-colors hover:bg-[color:var(--bg-3)]"
        >
          <p className="truncate text-xs font-semibold text-[color:var(--text-0)]">{item.id}</p>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {item.kinds.map((kind) => (
              <span
                key={`${item.id}-${kind}`}
                className="rounded bg-[color:var(--bg-3)] px-1.5 py-0.5 text-[10px] text-[color:var(--text-2)]"
              >
                {kind}
              </span>
            ))}
          </div>
        </button>
      ))}
    </div>
  );
}

function HistoryPanel({
  history,
  dirty,
}: {
  history: ReadonlyArray<{ label: string; value: string }>;
  dirty: boolean;
}) {
  return (
    <div className="space-y-2 p-3">
      {dirty && (
        <div className="rounded-md border border-[var(--border)] bg-[color:var(--bg-2)] px-2.5 py-2 text-xs text-[color:var(--text-1)]">
          Unsaved changes in current memory.
        </div>
      )}
      {history.map((entry) => (
        <div
          key={entry.label}
          className="rounded-md border border-[var(--border)] bg-[color:var(--bg-2)] px-2.5 py-2"
        >
          <p className="text-[10px] uppercase tracking-[0.12em] text-[color:var(--text-2)]">
            {entry.label}
          </p>
          <p className="mt-0.5 text-xs text-[color:var(--text-1)]">{entry.value}</p>
        </div>
      ))}
    </div>
  );
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "N/A";
  return date.toLocaleString();
}

function RawFileEditor({
  file,
  loading,
  onSave,
}: {
  file: RawFileDocument;
  loading: boolean;
  onSave: (path: string, content: string) => Promise<void>;
}) {
  const fileName = getFileName(file.path);
  const [content, setContent] = useState(file.content);

  useEffect(() => {
    setContent(file.content);
  }, [file.path, file.content]);

  const dirty = content !== file.content;
  const lineCount = content.length === 0 ? 0 : content.split(/\r?\n/).length;
  const language = file.kind === "yaml" ? "yaml" : file.kind;
  const records = useMemo(
    () => (file.kind === "jsonl" ? parseJsonl(content) : []),
    [content, file.kind],
  );
  const parsedCount = records.filter((item) => !item.error).length;
  const errorCount = records.length - parsedCount;

  const handleSave = useCallback(async () => {
    if (!dirty || loading) return;
    await onSave(file.path, content);
  }, [dirty, loading, onSave, file.path, content]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        void handleSave();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleSave]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-[color:var(--text-0)]">{fileName}</p>
          <p className="truncate text-xs text-[color:var(--text-2)]">{file.path}</p>
        </div>
        <span className="rounded-md border border-[var(--border)] bg-[color:var(--bg-2)] px-2 py-1 text-xs text-[color:var(--text-1)]">
          {language.toUpperCase()}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-[color:var(--text-2)]">
          <span>{lineCount} lines</span>
          {file.kind === "jsonl" && (
            <>
              <span>·</span>
              <span>{records.length} records</span>
              <span>·</span>
              <span>{parsedCount} parsed</span>
              {errorCount > 0 && (
                <>
                  <span>·</span>
                  <span>{errorCount} errors</span>
                </>
              )}
            </>
          )}
          <span>·</span>
          <span>{dirty ? "unsaved" : "saved"}</span>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={!dirty || loading}
            className={clsx(
              "ml-auto rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
              dirty
                ? "bg-[color:var(--accent)] text-white hover:brightness-110"
                : "cursor-not-allowed bg-[color:var(--bg-3)] text-[color:var(--text-2)]",
            )}
          >
            {loading ? "Saving..." : dirty ? "Save" : "Saved"}
          </button>
        </div>

        <RawSyntaxEditor
          value={content}
          kind={file.kind}
          onChange={setContent}
        />

        {file.kind === "jsonl" && (
          <div className="space-y-2">
            {records.length === 0 && (
              <p className="rounded-md border border-[var(--border)] bg-[color:var(--bg-2)] px-2.5 py-2 text-xs text-[color:var(--text-2)]">
                Empty JSONL file.
              </p>
            )}
            {records.map((record) => (
              <div
                key={`jsonl-${record.line}`}
                className="rounded-md border border-[var(--border)] bg-[color:var(--bg-2)]"
              >
                <div className="flex items-center justify-between border-b border-[var(--border)] px-2.5 py-1.5">
                  <p className="text-xs text-[color:var(--text-2)]">Line {record.line}</p>
                  <span className="text-[10px] text-[color:var(--text-2)]">
                    {record.error ? "INVALID" : "OK"}
                  </span>
                </div>
                {record.error ? (
                  <div className="px-2.5 py-2">
                    <p className="mb-1 text-xs text-[#e39ca3]">{record.error}</p>
                    <pre className="overflow-x-auto text-xs text-[color:var(--text-1)]">
                      <code>{record.raw}</code>
                    </pre>
                  </div>
                ) : (
                  <pre className="overflow-x-auto px-2.5 py-2 text-xs text-[color:var(--text-1)]">
                    <code>{record.pretty}</code>
                  </pre>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function parseJsonl(content: string): Array<{
  line: number;
  raw: string;
  pretty: string;
  error?: string;
}> {
  const lines = content.split(/\r?\n/);
  const results: Array<{ line: number; raw: string; pretty: string; error?: string }> = [];

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed.length === 0) return;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      results.push({
        line: index + 1,
        raw: line,
        pretty: JSON.stringify(parsed, null, 2),
      });
    } catch (e) {
      results.push({
        line: index + 1,
        raw: line,
        pretty: line,
        error: `JSON parse error: ${String(e)}`,
      });
    }
  });

  return results;
}

function getFileName(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] || path;
}

function RawSyntaxEditor({
  value,
  kind,
  onChange,
}: {
  value: string;
  kind: RawFileDocument["kind"];
  onChange: (value: string) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const highlightRef = useRef<HTMLPreElement | null>(null);

  const highlighted = useMemo(() => {
    if (kind === "yaml") return highlightYamlContent(value);
    if (kind === "jsonl") return highlightJsonlContent(value);
    return value;
  }, [value, kind]);

  const handleScroll = () => {
    if (!textareaRef.current || !highlightRef.current) return;
    highlightRef.current.scrollTop = textareaRef.current.scrollTop;
    highlightRef.current.scrollLeft = textareaRef.current.scrollLeft;
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Tab") return;
    e.preventDefault();
    const el = e.currentTarget;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const nextValue = `${value.slice(0, start)}  ${value.slice(end)}`;
    onChange(nextValue);
    requestAnimationFrame(() => {
      if (!textareaRef.current) return;
      textareaRef.current.selectionStart = start + 2;
      textareaRef.current.selectionEnd = start + 2;
    });
  };

  return (
    <div className="relative mb-3 min-h-[360px] w-full overflow-hidden rounded-md border border-[var(--border)] bg-[color:var(--bg-2)]">
      <pre
        ref={highlightRef}
        aria-hidden
        className="pointer-events-none absolute inset-0 overflow-auto whitespace-pre p-3 font-mono text-xs leading-5 text-[color:var(--text-1)]"
        style={{ fontVariantLigatures: "none" }}
      >
        {highlighted}
        {value.endsWith("\n") ? " " : ""}
      </pre>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={handleScroll}
        onKeyDown={handleKeyDown}
        spellCheck={false}
        wrap="off"
        className="absolute inset-0 min-h-[360px] w-full resize-none overflow-auto bg-transparent p-3 font-mono text-xs leading-5 text-transparent caret-[color:var(--text-0)] outline-none selection:bg-[color:var(--bg-3)]"
        style={{ fontVariantLigatures: "none" }}
      />
    </div>
  );
}

function highlightJsonlContent(content: string): ReactNode[] {
  const lines = content.split(/\r?\n/);
  return joinHighlightedLines(lines, highlightJsonLine);
}

function highlightYamlContent(content: string): ReactNode[] {
  const lines = content.split(/\r?\n/);
  return joinHighlightedLines(lines, highlightYamlLine);
}

function joinHighlightedLines(
  lines: string[],
  highlightLine: (line: string, lineIndex: number) => ReactNode[],
): ReactNode[] {
  const output: ReactNode[] = [];
  lines.forEach((line, index) => {
    output.push(...highlightLine(line, index));
    if (index < lines.length - 1) output.push("\n");
  });
  return output;
}

function highlightJsonLine(line: string, lineIndex: number): ReactNode[] {
  const tokenRegex =
    /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+\-]?\d+)?)|\b(true|false|null)\b|([{}\[\],:])/g;

  return tokenizeLine(line, tokenRegex, lineIndex, (match, tokenIndex) => {
    const stringToken = match[1];
    const keyColon = match[2];
    const numberToken = match[3];
    const literalToken = match[4];
    const punctToken = match[5];

    if (stringToken) {
      if (keyColon) {
        return (
          <span key={`j-key-${lineIndex}-${tokenIndex}`}>
            <span className="text-sky-300">{stringToken}</span>
            <span className="text-slate-400">{keyColon}</span>
          </span>
        );
      }
      return (
        <span key={`j-str-${lineIndex}-${tokenIndex}`} className="text-emerald-300">
          {stringToken}
        </span>
      );
    }

    if (numberToken) {
      return (
        <span key={`j-num-${lineIndex}-${tokenIndex}`} className="text-amber-300">
          {numberToken}
        </span>
      );
    }

    if (literalToken) {
      return (
        <span key={`j-lit-${lineIndex}-${tokenIndex}`} className="text-violet-300">
          {literalToken}
        </span>
      );
    }

    if (punctToken) {
      return (
        <span key={`j-punc-${lineIndex}-${tokenIndex}`} className="text-slate-400">
          {punctToken}
        </span>
      );
    }

    return "";
  });
}

function highlightYamlLine(line: string, lineIndex: number): ReactNode[] {
  const commentIndex = findYamlCommentIndex(line);
  const body = commentIndex >= 0 ? line.slice(0, commentIndex) : line;
  const comment = commentIndex >= 0 ? line.slice(commentIndex) : "";

  const output: ReactNode[] = [];
  let bodyHandled = false;

  const keyMatch = body.match(/^(\s*(?:-\s+)?)?([A-Za-z0-9_.-]+)(\s*:\s*)(.*)$/);
  if (keyMatch) {
    const [, prefix = "", key = "", colonSpace = "", value = ""] = keyMatch;
    if (prefix) output.push(prefix);
    output.push(
      <span key={`y-key-${lineIndex}`} className="text-sky-300">
        {key}
      </span>,
    );
    output.push(
      <span key={`y-colon-${lineIndex}`} className="text-slate-400">
        {colonSpace}
      </span>,
    );
    output.push(...highlightScalarYaml(value, lineIndex));
    bodyHandled = true;
  }

  if (!bodyHandled) {
    output.push(...highlightScalarYaml(body, lineIndex));
  }

  if (comment) {
    output.push(
      <span key={`y-comment-${lineIndex}`} className="text-slate-500">
        {comment}
      </span>,
    );
  }

  return output;
}

function highlightScalarYaml(value: string, lineIndex: number): ReactNode[] {
  const tokenRegex =
    /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|(-?\d+(?:\.\d+)?(?:[eE][+\-]?\d+)?)|\b(true|false|null|~)\b/gi;

  return tokenizeLine(value, tokenRegex, lineIndex, (match, tokenIndex) => {
    if (match[1]) {
      return (
        <span key={`y-str-${lineIndex}-${tokenIndex}`} className="text-emerald-300">
          {match[1]}
        </span>
      );
    }
    if (match[2]) {
      return (
        <span key={`y-num-${lineIndex}-${tokenIndex}`} className="text-amber-300">
          {match[2]}
        </span>
      );
    }
    if (match[3]) {
      return (
        <span key={`y-lit-${lineIndex}-${tokenIndex}`} className="text-violet-300">
          {match[3]}
        </span>
      );
    }
    return "";
  });
}

function tokenizeLine(
  line: string,
  regex: RegExp,
  lineIndex: number,
  renderMatch: (match: RegExpExecArray, tokenIndex: number) => ReactNode,
): ReactNode[] {
  const output: ReactNode[] = [];
  let cursor = 0;
  let tokenIndex = 0;

  regex.lastIndex = 0;
  while (true) {
    const match = regex.exec(line);
    if (!match) break;

    const start = match.index;
    const end = regex.lastIndex;
    if (start > cursor) {
      output.push(line.slice(cursor, start));
    }
    output.push(renderMatch(match, tokenIndex));
    cursor = end;
    tokenIndex += 1;
  }

  if (cursor < line.length) {
    output.push(line.slice(cursor));
  }
  if (output.length === 0) {
    output.push("");
  }

  return output.map((item, idx) =>
    typeof item === "string" ? (
      <span key={`plain-${lineIndex}-${idx}`}>{item}</span>
    ) : (
      item
    ),
  );
}

function findYamlCommentIndex(line: string): number {
  let inSingle = false;
  let inDouble = false;
  let escaped = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (inDouble) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inDouble = false;
      }
      continue;
    }
    if (inSingle) {
      if (char === "'") inSingle = false;
      continue;
    }
    if (char === "\"") {
      inDouble = true;
      continue;
    }
    if (char === "'") {
      inSingle = true;
      continue;
    }
    if (char === "#") {
      return i;
    }
  }
  return -1;
}
