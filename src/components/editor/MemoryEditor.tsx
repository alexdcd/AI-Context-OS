import { useState, useEffect, useCallback, useMemo, type ReactNode } from "react";
import { FileText, PanelRightClose, PanelRightOpen, Save, Trash2 } from "lucide-react";
import { clsx } from "clsx";
import { useAppStore } from "../../lib/store";
import { FrontmatterForm } from "./FrontmatterForm";
import { TipTapEditor } from "./TipTapEditor";
import type { MemoryMeta, MemoryType, RawFileDocument } from "../../lib/types";

type EditorMode = "both" | "l1" | "l2";
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
  const [mode, setMode] = useState<EditorMode>("l2");
  const [showInspector, setShowInspector] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("properties");

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

  const modifiedLabel = useMemo(() => {
    if (!meta) return "";
    return new Date(meta.modified).toLocaleString();
  }, [meta]);

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
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-[color:var(--text-2)]">
        <div className="rounded-xl border border-[var(--border)] bg-[color:var(--bg-2)]/45 p-4">
          <FileText className="h-10 w-10 text-[color:var(--text-1)]" />
        </div>
        <p className="text-base text-[color:var(--text-1)]">Selecciona una memoria para editar</p>
        <p className="max-w-md text-sm">
          Usa el panel izquierdo para abrir una nota y empezar a escribir en modo
          enfocado.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-[color:var(--text-0)]">{meta.id}</p>
          <p className="truncate text-xs text-[color:var(--text-2)]">{meta.l0 || "Sin resumen L0"}</p>
        </div>
        <div className="hidden items-center gap-1 rounded-md border border-[var(--border)] bg-[color:var(--bg-2)] px-1 py-1 md:flex">
          <ModeButton
            active={mode === "both"}
            label="Ambos"
            onClick={() => setMode("both")}
          />
          <ModeButton
            active={mode === "l1"}
            label="Solo L1"
            onClick={() => setMode("l1")}
          />
          <ModeButton
            active={mode === "l2"}
            label="Solo L2"
            onClick={() => setMode("l2")}
          />
        </div>
        <button
          type="button"
          onClick={() => setShowInspector((prev) => !prev)}
          className="rounded-md border border-[var(--border)] bg-[color:var(--bg-2)] px-2.5 py-1.5 text-[color:var(--text-1)] transition-colors hover:text-[color:var(--text-0)]"
          title={
            showInspector
              ? "Ocultar panel derecho (Cmd/Ctrl + \\)"
              : "Mostrar panel derecho (Cmd/Ctrl + \\)"
          }
        >
          {showInspector ? (
            <PanelRightClose className="h-4 w-4" />
          ) : (
            <PanelRightOpen className="h-4 w-4" />
          )}
        </button>
        <button
          type="button"
          onClick={handleDelete}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[color:var(--bg-2)] px-2.5 py-1.5 text-xs font-medium text-[color:var(--text-1)] transition-colors hover:bg-[color:var(--bg-3)] hover:text-[color:var(--text-0)] disabled:opacity-50"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete
        </button>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={!dirty || loading}
          className={clsx(
            "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
            dirty
              ? "bg-[color:var(--accent)] text-white hover:brightness-110"
              : "cursor-not-allowed bg-[color:var(--bg-3)] text-[color:var(--text-2)]",
          )}
        >
          <Save className="h-3.5 w-3.5" />
          {dirty ? "Save" : "Saved"}
        </button>
      </div>

      <div className="flex min-h-0 flex-1 gap-2 p-2">
        <div className="min-w-0 flex-1 overflow-y-auto p-2">
          <div className="mb-2 flex items-center justify-between rounded-md border border-[var(--border)] bg-[color:var(--bg-2)] px-3 py-1.5">
            <p className="text-xs text-[color:var(--text-2)]">
              Version {meta.version} · Última edición {modifiedLabel}
            </p>
            <p className="text-xs text-[color:var(--text-2)]">Cmd/Ctrl + S para guardar</p>
          </div>

          <div className="space-y-3">
            {mode !== "l2" && (
              <EditorSection
                title="L1 · Resumen enfocado"
                hint="Escribe la versión comprimida de la idea."
              >
                <TipTapEditor
                  content={l1}
                  onChange={(val) => {
                    setL1(val);
                    setDirty(true);
                  }}
                  className={mode === "both" ? "min-h-[180px]" : "min-h-[330px]"}
                  placeholder="Resumen principal en lenguaje claro..."
                />
              </EditorSection>
            )}

            {mode !== "l1" && (
              <EditorSection
                title="L2 · Contenido completo"
                hint="Desarrolla detalles, decisiones y referencias."
              >
                <TipTapEditor
                  content={l2}
                  onChange={(val) => {
                    setL2(val);
                    setDirty(true);
                  }}
                  className={mode === "both" ? "min-h-[260px]" : "min-h-[460px]"}
                  placeholder="Documento extenso en Markdown..."
                />
              </EditorSection>
            )}
          </div>
        </div>

        <aside
          className={clsx(
            "obs-inspector min-h-0",
            showInspector ? "w-[348px] opacity-100" : "pointer-events-none w-0 opacity-0",
          )}
        >
          <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-md border border-[var(--border)] bg-[color:var(--bg-1)]">
            <div className="border-b border-[var(--border)] px-3 py-2.5">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--text-1)]">
                Inspector
              </p>
              <p className="mt-1 text-xs text-[color:var(--text-2)]">
                Propiedades y relaciones de la memoria
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 border-b border-[var(--border)] px-3 py-2">
              <InspectorMetric label="Type" value={meta.memory_type} />
              <InspectorMetric label="Importance" value={meta.importance.toFixed(2)} />
              <InspectorMetric label="Confidence" value={meta.confidence.toFixed(2)} />
              <InspectorMetric
                label="Links"
                value={String(outgoingLinks.length + incomingLinks.length)}
              />
            </div>

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

function ModeButton({
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
      className={
        active
          ? "rounded-md bg-[color:var(--bg-3)] px-2 py-1 text-xs text-[color:var(--text-0)]"
          : "rounded-md px-2 py-1 text-xs text-[color:var(--text-2)] transition-colors hover:text-[color:var(--text-0)]"
      }
    >
      {label}
    </button>
  );
}

function EditorSection({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div
        className="flex items-center justify-between rounded-md border border-[var(--border)] bg-[color:var(--bg-2)] px-3 py-1.5"
      >
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--text-1)]">{title}</p>
        <p className="text-[11px] text-[color:var(--text-2)]">{hint}</p>
      </div>
      {children}
    </section>
  );
}

function InspectorMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[color:var(--bg-2)]/55 px-2 py-1.5">
      <p className="text-[10px] uppercase tracking-[0.1em] text-[color:var(--text-2)]">{label}</p>
      <p className="truncate text-xs text-[color:var(--text-1)]">{value}</p>
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
      className={
        active
          ? "rounded-md bg-[color:var(--bg-3)] px-2 py-1 text-xs font-medium text-[color:var(--text-0)]"
          : "rounded-md px-2 py-1 text-xs text-[color:var(--text-2)] transition-colors hover:text-[color:var(--text-0)]"
      }
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

        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          spellCheck={false}
          className="mb-3 min-h-[360px] w-full resize-y rounded-md border border-[var(--border)] bg-[color:var(--bg-2)] p-3 font-mono text-xs leading-5 text-[color:var(--text-1)] focus:border-[color:var(--accent)] focus:outline-none"
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
