import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { FileText, PanelRightClose, PanelRightOpen, Trash2, ChevronRight } from "lucide-react";
import { clsx } from "clsx";
import { useAppStore } from "../../lib/store";
import { FrontmatterForm } from "./FrontmatterForm";
import { TipTapEditor } from "./TipTapEditor";
import type { Memory, MemoryMeta, MemoryType, RawFileDocument } from "../../lib/types";

type InspectorTab = "properties" | "links" | "history";
type SaveStatus = "saved" | "dirty" | "saving" | "error";

const AUTO_SAVE_DELAY_MS = 300;

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

interface MemoryDraft {
  sourceId: string;
  l1: string;
  l2: string;
  meta: MemoryMeta;
  refreshDerivedState: boolean;
}

interface RawFileDraft {
  path: string;
  content: string;
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
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [showInspector, setShowInspector] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("properties");
  const [l1Open, setL1Open] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestDraftRef = useRef<MemoryDraft | null>(null);
  const queuedDraftRef = useRef<MemoryDraft | null>(null);
  const isSavingRef = useRef(false);

  useEffect(() => {
    if (activeMemory) {
      setMeta(activeMemory.meta);
      setL1(activeMemory.l1_content);
      setL2(activeMemory.l2_content);
      setDirty(false);
      setSaveStatus("saved");
      setInspectorTab("properties");
    }
  }, [activeMemory]);

  const handleMetaChange = useCallback((updated: MemoryMeta) => {
    setMeta(updated);
    setDirty(true);
    setSaveStatus("dirty");
  }, []);

  useEffect(() => {
    if (!activeMemory || !meta || !dirty || activeMemory.meta.id !== meta.id) {
      latestDraftRef.current = null;
      return;
    }

    latestDraftRef.current = {
      sourceId: activeMemory.meta.id,
      l1,
      l2,
      meta,
      refreshDerivedState: hasDerivedMemoryChanges(activeMemory, meta),
    };
  }, [activeMemory, meta, l1, l2, dirty]);

  const flushQueuedSave = useCallback(async () => {
    if (isSavingRef.current || !queuedDraftRef.current) return;

    isSavingRef.current = true;

    while (queuedDraftRef.current) {
      const draft = queuedDraftRef.current;
      queuedDraftRef.current = null;
      setSaveStatus("saving");

      try {
        await saveActiveMemory(
          draft.sourceId,
          draft.l1,
          draft.l2,
          draft.meta,
          draft.refreshDerivedState,
        );

        const currentActiveId = useAppStore.getState().activeMemory?.meta.id;
        if (currentActiveId === draft.sourceId || currentActiveId === draft.meta.id) {
          setDirty(false);
          setSaveStatus("saved");
        }
      } catch {
        setSaveStatus("error");
        isSavingRef.current = false;
        return;
      }
    }

    isSavingRef.current = false;
  }, [saveActiveMemory]);

  const queueSave = useCallback((draft: MemoryDraft) => {
    queuedDraftRef.current = draft;
    void flushQueuedSave();
  }, [flushQueuedSave]);

  const handleSave = useCallback(async () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }

    const draft = latestDraftRef.current;
    if (!draft) return;

    queueSave(draft);
    await flushQueuedSave();
  }, [flushQueuedSave, queueSave]);

  useEffect(() => {
    if (!latestDraftRef.current) return;

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = setTimeout(() => {
      const draft = latestDraftRef.current;
      if (draft) {
        queueSave(draft);
      }
    }, AUTO_SAVE_DELAY_MS);

    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [activeMemory?.meta.id, l1, l2, meta, dirty, queueSave]);

  useEffect(() => {
    const documentId = activeMemory?.meta.id;

    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }

      const draft = latestDraftRef.current;
      if (documentId && draft?.sourceId === documentId) {
        queueSave(draft);
      }
    };
  }, [activeMemory?.meta.id, queueSave]);

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
      `Eliminar memoria "${meta.id}"?\n\nEsto borrara el archivo de forma permanente.`,
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
    meta.derived_from.forEach((id) => pushLink(id, "derived_from"));
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
      if (item.derived_from.includes(targetId)) kinds.push("derived_from");
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
      { label: "Creado", value: formatTimestamp(meta.created) },
      { label: "Modificado", value: formatTimestamp(meta.modified) },
      { label: "Ultimo acceso", value: formatTimestamp(meta.last_access) },
      { label: "Version", value: `v${meta.version}` },
      { label: "Accesos", value: String(meta.access_count) },
    ];
  }, [meta]);
  const isProtected = meta?.protected ?? false;
  const isStateSynced = meta?.id === activeMemory?.meta.id;

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
          key={activeRawFile.path}
          file={activeRawFile}
          onSave={saveRawFile}
        />
      );
    }

    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-[color:var(--text-2)]">
        <FileText className="h-8 w-8 text-[color:var(--text-2)]" />
        <p className="text-sm text-[color:var(--text-1)]">Selecciona un archivo para editar</p>
        <p className="max-w-sm text-xs">
          Usa el explorador lateral para abrir una nota o archivo.
        </p>
      </div>
    );
  }

  if (!isStateSynced) {
    return null;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Minimal top bar — actions only */}
      <div className="flex items-center gap-1.5 border-b border-[var(--border)] px-4 py-1.5">
        <span className="flex-1 font-mono text-[11px] text-[color:var(--text-2)]">{meta.id}.md</span>
        <SaveStateBadge status={saveStatus} />
        <button
          type="button"
          onClick={() => setShowInspector((prev) => !prev)}
          className="rounded p-1 text-[color:var(--text-2)] transition-colors hover:text-[color:var(--text-1)]"
          title={showInspector ? "Ocultar inspector" : "Mostrar inspector"}
        >
          {showInspector ? <PanelRightClose className="h-3.5 w-3.5" /> : <PanelRightOpen className="h-3.5 w-3.5" />}
        </button>
        <button
          type="button"
          onClick={handleDelete}
          disabled={loading || isProtected}
          className="rounded p-1 text-[color:var(--text-2)] transition-colors hover:text-[color:var(--danger)] disabled:opacity-50"
          title={isProtected ? "Archivo protegido" : "Eliminar memoria"}
        >
          <Trash2 className="h-3.5 w-3.5" />
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
              readOnly={isProtected}
              placeholder="Sin titulo"
              className="mb-1 w-full bg-transparent text-2xl font-semibold text-[color:var(--text-0)] placeholder:text-[color:var(--text-2)]/40 focus:outline-none"
            />
            <p className="mb-6 font-mono text-[11px] text-[color:var(--text-2)]">
              {meta.memory_type}
              {meta.importance >= 0.7 ? " · alta" : meta.importance >= 0.4 ? "" : " · baja"}
              {meta.always_load && " · fijada"}
              {meta.tags.length > 0 && ` · ${meta.tags.join(", ")}`}
              {" · "}contenido L2 · v{meta.version}
            </p>

            {/* L2 — Main content */}
            <TipTapEditor
              key={`${activeMemory.meta.id}-l2`}
              documentKey={`${activeMemory.meta.id}-l2`}
              content={l2}
              onChange={(val) => {
                setL2(val);
                setDirty(true);
                setSaveStatus("dirty");
              }}
              onBlur={() => void handleSave()}
              className="min-h-[400px]"
              placeholder="Escribe aqui..."
              editable={!isProtected}
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
                L1 · Resumen ampliado
              </button>
              {l1Open && (
                <div className="mt-2">
                  <TipTapEditor
                    key={`${activeMemory.meta.id}-l1`}
                    documentKey={`${activeMemory.meta.id}-l1`}
                    content={l1}
                    onChange={(val) => {
                      setL1(val);
                      setDirty(true);
                      setSaveStatus("dirty");
                    }}
                    onBlur={() => void handleSave()}
                    className="min-h-[120px]"
                    placeholder="Resumen L1 (150-300 tokens)..."
                    editable={!isProtected}
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
                label="Propiedades"
                onClick={() => setInspectorTab("properties")}
              />
              <InspectorTabButton
                active={inspectorTab === "links"}
                label="Enlaces"
                onClick={() => setInspectorTab("links")}
              />
              <InspectorTabButton
                active={inspectorTab === "history"}
                label="Historial"
                onClick={() => setInspectorTab("history")}
              />
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {inspectorTab === "properties" && (
                <FrontmatterForm meta={meta} onChange={handleMetaChange} readonly={isProtected} />
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
      <LinkGroup title="Salientes" links={outgoing} onOpenMemory={onOpenMemory} />
      <div className="space-y-2">
        <p className="text-[10px] uppercase tracking-[0.12em] text-[color:var(--text-2)]">
          Entrantes
        </p>
        {incoming.length === 0 && (
          <p className="rounded-md border border-[var(--border)] bg-[color:var(--bg-2)] px-2.5 py-2 text-xs text-[color:var(--text-2)]">
            Sin backlinks.
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
          Sin enlaces.
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
          Hay cambios pendientes de sincronizar.
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
  if (Number.isNaN(date.getTime())) return "No disponible";
  return date.toLocaleString();
}

function SaveStateBadge({ status }: { status: SaveStatus }) {
  const label =
    status === "saving"
      ? "Guardando..."
      : status === "error"
        ? "Error al guardar"
        : status === "dirty"
          ? "Pendiente"
          : "Guardado";

  return (
    <span
      className={clsx(
        "rounded-full border px-2 py-0.5 text-[10px] font-medium",
        status === "error"
          ? "border-[color:var(--danger)]/40 text-[color:var(--danger)]"
          : status === "saving" || status === "dirty"
            ? "border-[color:var(--accent)]/30 text-[color:var(--accent)]"
            : "border-[var(--border)] text-[color:var(--text-2)]",
      )}
    >
      {label}
    </span>
  );
}

function RawFileEditor({
  file,
  onSave,
}: {
  file: RawFileDocument;
  onSave: (path: string, content: string) => Promise<void>;
}) {
  const fileName = getFileName(file.path);
  const [content, setContent] = useState(file.content);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestDraftRef = useRef<RawFileDraft | null>(null);
  const queuedDraftRef = useRef<RawFileDraft | null>(null);
  const isSavingRef = useRef(false);

  useEffect(() => {
    setContent(file.content);
    setSaveStatus("saved");
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

  useEffect(() => {
    latestDraftRef.current = dirty ? { path: file.path, content } : null;
  }, [content, dirty, file.path]);

  const flushQueuedSave = useCallback(async () => {
    if (isSavingRef.current || !queuedDraftRef.current) return;

    isSavingRef.current = true;

    while (queuedDraftRef.current) {
      const draft = queuedDraftRef.current;
      queuedDraftRef.current = null;
      setSaveStatus("saving");

      try {
        await onSave(draft.path, draft.content);
        if (draft.path === file.path) {
          setSaveStatus("saved");
        }
      } catch {
        setSaveStatus("error");
        isSavingRef.current = false;
        return;
      }
    }

    isSavingRef.current = false;
  }, [file.path, onSave]);

  const queueSave = useCallback((draft: RawFileDraft) => {
    queuedDraftRef.current = draft;
    void flushQueuedSave();
  }, [flushQueuedSave]);

  const handleSave = useCallback(async () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }

    const draft = latestDraftRef.current;
    if (!draft) return;

    queueSave(draft);
    await flushQueuedSave();
  }, [flushQueuedSave, queueSave]);

  useEffect(() => {
    if (!latestDraftRef.current) return;

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = setTimeout(() => {
      const draft = latestDraftRef.current;
      if (draft) {
        queueSave(draft);
      }
    }, AUTO_SAVE_DELAY_MS);

    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [content, dirty, file.path, queueSave]);

  useEffect(() => {
    const filePath = file.path;

    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }

      const draft = latestDraftRef.current;
      if (draft?.path === filePath) {
        queueSave(draft);
      }
    };
  }, [file.path, queueSave]);

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
        <SaveStateBadge status={saveStatus} />
        <span className="rounded-md border border-[var(--border)] bg-[color:var(--bg-2)] px-2 py-1 text-xs text-[color:var(--text-1)]">
          {language.toUpperCase()}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-[color:var(--text-2)]">
          <span>{lineCount} lineas</span>
          {file.kind === "jsonl" && (
            <>
              <span>·</span>
              <span>{records.length} registros</span>
              <span>·</span>
              <span>{parsedCount} validos</span>
              {errorCount > 0 && (
                <>
                  <span>·</span>
                  <span>{errorCount} errores</span>
                </>
              )}
            </>
          )}
          <span>·</span>
          <span>{dirty ? "pendiente" : "sincronizado"}</span>
        </div>

        <RawSyntaxEditor
          value={content}
          onChange={(value) => {
            setContent(value);
            setSaveStatus("dirty");
          }}
          onBlur={() => void handleSave()}
        />

        {file.kind === "jsonl" && (
          <div className="space-y-2">
            {records.length === 0 && (
              <p className="rounded-md border border-[var(--border)] bg-[color:var(--bg-2)] px-2.5 py-2 text-xs text-[color:var(--text-2)]">
                Archivo JSONL vacio.
              </p>
            )}
            {records.map((record) => (
              <div
                key={`jsonl-${record.line}`}
                className="rounded-md border border-[var(--border)] bg-[color:var(--bg-2)]"
              >
                <div className="flex items-center justify-between border-b border-[var(--border)] px-2.5 py-1.5">
                  <p className="text-xs text-[color:var(--text-2)]">Linea {record.line}</p>
                  <span className="text-[10px] text-[color:var(--text-2)]">
                    {record.error ? "INVALIDO" : "OK"}
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
        error: `Error al parsear JSON: ${String(e)}`,
      });
    }
  });

  return results;
}

function getFileName(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] || path;
}

function hasDerivedMemoryChanges(previous: Memory, next: MemoryMeta) {
  return JSON.stringify(toComparableMemoryMeta(previous.meta)) !== JSON.stringify(toComparableMemoryMeta(next));
}

function toComparableMemoryMeta(meta: MemoryMeta) {
  return {
    id: meta.id,
    memory_type: meta.memory_type,
    l0: meta.l0,
    importance: meta.importance,
    always_load: meta.always_load,
    decay_rate: meta.decay_rate,
    confidence: meta.confidence,
    tags: meta.tags,
    related: meta.related,
    triggers: meta.triggers,
    requires: meta.requires,
    optional: meta.optional,
    output_format: meta.output_format,
    ontology: meta.ontology,
    status: meta.status,
    protected: meta.protected,
    derived_from: meta.derived_from,
  };
}

function RawSyntaxEditor({
  value,
  onChange,
  onBlur,
}: {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

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
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        onKeyDown={handleKeyDown}
        spellCheck={false}
        wrap="off"
        className="absolute inset-0 min-h-[360px] w-full resize-none overflow-auto bg-transparent p-3 font-mono text-xs leading-5 text-[color:var(--text-1)] caret-[color:var(--text-0)] outline-none selection:bg-[color:var(--bg-3)]"
        style={{ fontVariantLigatures: "none", tabSize: 2 }}
      />
    </div>
  );
}
