import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  AlertTriangle,
  ChevronRight,
  FileText,
  Link2Off,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { clsx } from "clsx";
import { listen } from "@tauri-apps/api/event";
import { markRecentLocalWriteForPath, useAppStore } from "../../lib/store";
import { useSettingsStore } from "../../lib/settingsStore";
import { FrontmatterForm } from "./FrontmatterForm";
import { HybridMarkdownEditor } from "./HybridMarkdownEditor";
import { FormatToolbar } from "./FormatToolbar";
import type { EditorView } from "@codemirror/view";
import type {
  BacklinkRef,
  FileNode,
  Memory,
  MemoryMeta,
  MemoryOntology,
  RawFileDocument,
  WikilinkCandidate,
  WikilinkSaveWarning,
} from "../../lib/types";
import { createMemoryAtPath, getBacklinks } from "../../lib/tauri";
import {
  nextUniqueMemoryId,
  slugifyMemoryId,
  type WikilinkDraftMemory,
  type WikilinkTarget,
} from "./editorWikilinks";

type InspectorTab = "properties" | "links" | "history";
type SaveStatus = "saved" | "dirty" | "saving" | "error";

const AUTO_SAVE_DELAY_MS = 700;

interface OutgoingLink {
  id: string;
  kinds: string[];
}

interface IncomingLink {
  id: string;
  l0: string;
  ontology: MemoryOntology;
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

interface CreateMemoryDialogState {
  sourceText: string;
  warning?: WikilinkSaveWarning;
  suggestedDraft: WikilinkDraftMemory;
}

interface MemoryDirectoryOption {
  path: string;
  label: string;
}

export function MemoryEditor() {
  const { t } = useTranslation();
  const activeMemory = useAppStore((state) => state.activeMemory);
  const activeRawFile = useAppStore((state) => state.activeRawFile);
  const saveActiveMemory = useAppStore((state) => state.saveActiveMemory);
  const saveRawFile = useAppStore((state) => state.saveRawFile);
  const deleteMemory = useAppStore((state) => state.deleteMemory);
  const loading = useAppStore((state) => state.loading);
  const fileTree = useAppStore((state) => state.fileTree);
  const memories = useAppStore((state) => state.memories);
  const selectFile = useAppStore((state) => state.selectFile);
  const setError = useAppStore((state) => state.setError);
  const showMarkdownSyntax = useSettingsStore((s) => s.showMarkdownSyntax);
  const appearanceMode = useSettingsStore((s) => s.appearanceMode);
  const [meta, setMeta] = useState<MemoryMeta | null>(null);
  const [l1, setL1] = useState("");
  const [l2, setL2] = useState("");
  const [dirty, setDirty] = useState(false);
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [showInspector, setShowInspector] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("properties");
  const [l1Open, setL1Open] = useState(false);
  const [wikilinkWarnings, setWikilinkWarnings] = useState<WikilinkSaveWarning[]>([]);
  const [warningsCollapsed, setWarningsCollapsed] = useState(false);
  const [createMemoryDialog, setCreateMemoryDialog] = useState<CreateMemoryDialogState | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestDraftRef = useRef<MemoryDraft | null>(null);
  const queuedDraftRef = useRef<MemoryDraft | null>(null);
  const isSavingRef = useRef(false);
  const editorViewRef = useRef<EditorView | null>(null);
  const pendingWikilinkCreationsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!activeMemory) return;

    // Only reset local editor state when switching to a different document.
    if (sourceId !== activeMemory.meta.id) {
      setMeta(activeMemory.meta);
      setL1(activeMemory.l1_content);
      setL2(activeMemory.l2_content);
      setSourceId(activeMemory.meta.id);
      setDirty(false);
      setSaveStatus("saved");
      setInspectorTab("properties");
      setWikilinkWarnings([]);
      setWarningsCollapsed(false);
      setCreateMemoryDialog(null);
      return;
    }

    // Same document: keep the user's local typing/cursor stable.
    if (!dirty && !isSavingRef.current) {
      setMeta(activeMemory.meta);
      setL1(activeMemory.l1_content);
      setL2(activeMemory.l2_content);
      setSaveStatus("saved");
    }
  }, [activeMemory, sourceId, dirty]);

  const handleMetaChange = useCallback((updated: MemoryMeta) => {
    setMeta(updated);
    setDirty(true);
    setSaveStatus("dirty");
  }, []);

  useEffect(() => {
    if (!activeMemory || !meta || !dirty || !sourceId || sourceId !== activeMemory.meta.id) {
      latestDraftRef.current = null;
      return;
    }

    latestDraftRef.current = {
      sourceId,
      l1,
      l2,
      meta,
      refreshDerivedState: hasDerivedMemoryChanges(activeMemory, meta),
    };
  }, [activeMemory, sourceId, meta, l1, l2, dirty]);

  const flushQueuedSave = useCallback(async () => {
    if (isSavingRef.current || !queuedDraftRef.current) return;

    isSavingRef.current = true;

    while (queuedDraftRef.current) {
      const draft = queuedDraftRef.current;
      queuedDraftRef.current = null;
      setSaveStatus("saving");

      try {
        const result = await saveActiveMemory(
          draft.sourceId,
          draft.l1,
          draft.l2,
          draft.meta,
          draft.refreshDerivedState,
        );

        const currentActiveId = useAppStore.getState().activeMemory?.meta.id;
        if (currentActiveId === draft.sourceId || currentActiveId === draft.meta.id) {
          const visibleWarnings = filterTransientWikilinkWarnings(
            result.wikilink_warnings,
            pendingWikilinkCreationsRef.current,
          );
          setDirty(false);
          setSaveStatus("saved");
          setWikilinkWarnings(visibleWarnings);
          if (visibleWarnings.length > 0) {
            setWarningsCollapsed(false);
          }
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
      `Delete memory "${meta.id}"?\n\nThis will delete the file permanently.`,
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
    if (!meta || inspectorTab !== "links") return [];
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
        ontology: item.type,
        kinds,
      });
    }

    return results.sort((a, b) => a.id.localeCompare(b.id));
  }, [memories, meta, inspectorTab]);

  const historyEntries = useMemo(() => {
    if (!meta) return [] as Array<{ label: string; value: string }>;
    return [
      { label: t("memoryEditor.history.created"), value: formatTimestamp(meta.created, t) },
      { label: t("memoryEditor.history.modified"), value: formatTimestamp(meta.modified, t) },
      { label: t("memoryEditor.history.lastAccess"), value: formatTimestamp(meta.last_access, t) },
      { label: t("memoryEditor.history.version"), value: `v${meta.version}` },
      { label: t("memoryEditor.history.accessCount"), value: String(meta.access_count) },
    ];
  }, [meta, t]);
  const isProtected = meta?.protected ?? false;
  const isStateSynced = meta?.id === activeMemory?.meta.id;

  const handleOpenMemory = useCallback(
    async (id: string) => {
      try {
        await selectFile(id);
      } catch (e) {
        setError(`Could not open memory ${id}: ${String(e)}`);
      }
    },
    [selectFile, setError],
  );

  const wikilinkTargets = useStableWikilinkTargets(memories);
  const memoryDirectoryOptions = useMemo(
    () => collectMemoryDirectoryOptions(fileTree),
    [fileTree],
  );
  const preferredMemoryDirectory = useMemo(
    () => getPreferredMemoryDirectory(activeMemory?.file_path, memoryDirectoryOptions),
    [activeMemory?.file_path, memoryDirectoryOptions],
  );

  const createLinkedMemory = useCallback(
    async (
      draft: { id: string; l0: string; ontology: MemoryOntology },
      targetDirectory: string,
    ) => {
      pendingWikilinkCreationsRef.current.add(draft.id);
      pendingWikilinkCreationsRef.current.add(draft.l0);
      try {
        const input = {
          id: draft.id,
          ontology: draft.ontology,
          l0: draft.l0,
          importance: 0.5,
          tags: [],
          l1_content: "",
          l2_content: "",
        };
        const created = await createMemoryAtPath(input, targetDirectory);
        markRecentLocalWriteForPath(created.file_path);
        useAppStore.setState((state) => ({
          memories: upsertMemoryMeta(state.memories, created.meta),
        }));
        setWikilinkWarnings((prev) =>
          prev.filter(
            (warning) =>
              !(
                warning.kind === "unresolved" &&
                (warning.text === draft.id || warning.text === draft.l0)
              ),
          ),
        );
        return created;
      } catch (error) {
        setError(String(error));
        return null;
      } finally {
        pendingWikilinkCreationsRef.current.delete(draft.id);
        pendingWikilinkCreationsRef.current.delete(draft.l0);
      }
    },
    [setError],
  );

  const handleCreateWikilinkMemory = useCallback(
    async (draft: WikilinkDraftMemory) => {
      setCreateMemoryDialog({
        sourceText: draft.l0,
        suggestedDraft: draft,
      });
    },
    [],
  );

  const applyWikilinkCandidate = useCallback(
    (warning: WikilinkSaveWarning, candidateId: string) => {
      const rewrite = (body: string) => rewriteWikilinkText(body, warning.text, candidateId);
      if (warning.level === "l1") {
        setL1((prev) => rewrite(prev));
      } else {
        setL2((prev) => rewrite(prev));
      }
      setDirty(true);
      setSaveStatus("dirty");
      setWikilinkWarnings((prev) =>
        prev.filter(
          (w) => !(w.level === warning.level && w.text === warning.text),
        ),
      );
    },
    [],
  );

  const confirmCreateMemory = useCallback(
    async (draft: {
      id: string;
      l0: string;
      ontology: MemoryOntology;
      directory: string;
    }) => {
      if (!createMemoryDialog) return;
      const created = await createLinkedMemory(
        { id: draft.id, l0: draft.l0, ontology: draft.ontology },
        draft.directory,
      );
      if (!created) return;

      if (createMemoryDialog.warning) {
        applyWikilinkCandidate(createMemoryDialog.warning, draft.id);
      } else {
        setL2((prev) => rewriteWikilinkText(prev, createMemoryDialog.sourceText, draft.id));
        setDirty(true);
        setSaveStatus("dirty");
      }

      setCreateMemoryDialog(null);
    },
    [applyWikilinkCandidate, createLinkedMemory, createMemoryDialog],
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
        <p className="text-sm text-[color:var(--text-1)]">{t("memoryEditor.empty.title")}</p>
        <p className="max-w-sm text-xs">
          {t("memoryEditor.empty.description")}
        </p>
      </div>
    );
  }

  if (!isStateSynced) {
    return null;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="relative z-40 flex items-center gap-2 border-b border-[var(--border)] px-4 py-1.5">
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[11px] text-[color:var(--text-2)]">{meta.id}.md</div>
        </div>
        <SaveStateBadge status={saveStatus} />
        <FormatToolbar viewRef={editorViewRef} disabled={isProtected} />
        <button
          type="button"
          onClick={() => setShowInspector((prev) => !prev)}
          className="rounded p-1 text-[color:var(--text-2)] transition-colors hover:text-[color:var(--text-1)]"
          title={showInspector ? t("memoryEditor.actions.hideInspector") : t("memoryEditor.actions.showInspector")}
        >
          {showInspector ? <PanelRightClose className="h-3.5 w-3.5" /> : <PanelRightOpen className="h-3.5 w-3.5" />}
        </button>
        <button
          type="button"
          onClick={handleDelete}
          disabled={loading || isProtected}
          className="rounded p-1 text-[color:var(--text-2)] transition-colors hover:text-[color:var(--danger)] disabled:opacity-50"
          title={isProtected ? t("explorer.protected") : t("memoryEditor.actions.deleteMemory")}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[820px] px-3 py-6 sm:px-5 lg:px-8">
            <div
              className={clsx(
                "py-7",
                appearanceMode === "modern"
                  ? "rounded-2xl border border-[var(--border)] bg-[color:var(--bg-1)] px-4 shadow-sm sm:px-6 lg:px-8"
                  : "px-0 sm:px-1 lg:px-2",
              )}
            >
              <input
                type="text"
                value={meta.l0}
                onChange={(e) => {
                  handleMetaChange({ ...meta, l0: e.target.value });
                }}
                readOnly={isProtected}
                placeholder={t("memoryEditor.untitled")}
                className="mb-2 w-full bg-transparent text-[2.35rem] font-semibold leading-[1.05] tracking-[-0.04em] text-[color:var(--text-0)] placeholder:text-[color:var(--text-2)]/40 focus:outline-none"
              />
              <p className="mb-8 font-mono text-[11px] leading-5 text-[color:var(--text-2)]">
                {meta.type}
                {meta.system_role && ` · ${meta.system_role}`}
                {meta.folder_category && ` · ${meta.folder_category}`}
                {meta.importance >= 0.7 ? ` · ${t("memoryEditor.meta.high")}` : meta.importance >= 0.4 ? "" : ` · ${t("memoryEditor.meta.low")}`}
                {meta.tags.length > 0 && ` · ${meta.tags.join(", ")}`}
                {` · ${t("memoryEditor.meta.l2Content")} · v${meta.version}`}
              </p>

              {wikilinkWarnings.length > 0 && (
                <WikilinkWarningsBanner
                  warnings={wikilinkWarnings}
                  collapsed={warningsCollapsed}
                  onToggleCollapsed={() => setWarningsCollapsed((prev) => !prev)}
                  onPickCandidate={applyWikilinkCandidate}
                  onCreateMemory={(warning) =>
                    setCreateMemoryDialog({
                      sourceText: warning.text,
                      warning,
                      suggestedDraft: {
                        id: nextUniqueMemoryId(warning.text, wikilinkTargets),
                        l0: warning.text,
                      },
                    })
                  }
                />
              )}

              <HybridMarkdownEditor
                key={`${activeMemory.meta.id}-l2-${showMarkdownSyntax ? "raw" : "preview"}`}
                content={l2}
                onChange={(val) => {
                  setL2(val);
                  setDirty(true);
                  setSaveStatus("dirty");
                }}
                className="min-h-[520px]"
                placeholder={t("memoryEditor.placeholders.typeHere")}
                editable={!isProtected}
                viewRef={editorViewRef}
                showSyntax={showMarkdownSyntax}
                wikilinkTargets={wikilinkTargets}
                onOpenWikilink={handleOpenMemory}
                onCreateWikilinkMemory={handleCreateWikilinkMemory}
              />

              {createMemoryDialog && (
                <BrokenLinkCreateDialog
                  text={createMemoryDialog.sourceText}
                  suggestedDraft={createMemoryDialog.suggestedDraft}
                  targets={wikilinkTargets}
                  directoryOptions={memoryDirectoryOptions}
                  defaultDirectory={preferredMemoryDirectory}
                  onCancel={() => setCreateMemoryDialog(null)}
                  onConfirm={(draft) => void confirmCreateMemory(draft)}
                />
              )}

              <div className="mt-10 border-t border-[color:color-mix(in_srgb,var(--accent)_12%,var(--border))] pt-4">
                <button
                  type="button"
                  onClick={() => setL1Open((prev) => !prev)}
                  className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[color:var(--text-2)] transition-colors hover:text-[color:var(--text-1)]"
                >
                  <ChevronRight
                    className={clsx(
                      "h-3 w-3 transition-transform",
                      l1Open && "rotate-90",
                    )}
                  />
                  {t("memoryEditor.l1Title")}
                </button>
                {l1Open && (
                  <div className="mt-2">
                    <textarea
                      value={l1}
                      onChange={(e) => {
                        setL1(e.target.value);
                        setDirty(true);
                        setSaveStatus("dirty");
                      }}
                      onBlur={() => void handleSave()}
                      readOnly={isProtected}
                      placeholder={t("memoryEditor.placeholders.l1Summary")}
                      rows={3}
                      className={clsx(
                        "w-full resize-y px-4 py-3 text-sm leading-relaxed text-[color:var(--text-1)] placeholder:text-[color:var(--text-2)]/40 focus:outline-none",
                        appearanceMode === "modern"
                          ? "rounded-2xl border border-[var(--border)] bg-[color:var(--bg-0)]"
                          : "rounded-lg border border-[color:color-mix(in_srgb,var(--border)_78%,transparent)] bg-transparent",
                      )}
                    />
                  </div>
                )}
              </div>
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
                label={t("memoryEditor.tabs.properties")}
                onClick={() => setInspectorTab("properties")}
              />
              <InspectorTabButton
                active={inspectorTab === "links"}
                label={t("memoryEditor.tabs.links")}
                onClick={() => setInspectorTab("links")}
              />
              <InspectorTabButton
                active={inspectorTab === "history"}
                label={t("memoryEditor.tabs.history")}
                onClick={() => setInspectorTab("history")}
              />
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {inspectorTab === "properties" && (
                <FrontmatterForm meta={meta} onChange={handleMetaChange} readonly={isProtected} />
              )}
              {inspectorTab === "links" && (
                <LinksPanel
                  memoryId={meta.id}
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
  memoryId,
  outgoing,
  incoming,
  onOpenMemory,
}: {
  memoryId: string;
  outgoing: OutgoingLink[];
  incoming: IncomingLink[];
  onOpenMemory: (id: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="space-y-3 p-3">
      <LinkGroup title={t("memoryEditor.links.outgoing")} links={outgoing} onOpenMemory={onOpenMemory} />
      <div className="space-y-2">
        <p className="text-[10px] uppercase tracking-[0.12em] text-[color:var(--text-2)]">
          {t("memoryEditor.links.incoming")}
        </p>
        {incoming.length === 0 && (
          <p className="rounded-md border border-[var(--border)] bg-[color:var(--bg-2)] px-2.5 py-2 text-xs text-[color:var(--text-2)]">
            {t("memoryEditor.links.noBacklinks")}
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
                {item.ontology}
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
      <BacklinksPanel memoryId={memoryId} onOpenMemory={onOpenMemory} />
    </div>
  );
}

const BACKLINKS_REFRESH_DEBOUNCE_MS = 250;

function BacklinksPanel({
  memoryId,
  onOpenMemory,
}: {
  memoryId: string;
  onOpenMemory: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [backlinks, setBacklinks] = useState<BacklinkRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(true);
  const currentIdRef = useRef(memoryId);

  useEffect(() => {
    currentIdRef.current = memoryId;
  }, [memoryId]);

  const refetch = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const next = await getBacklinks(id);
      if (currentIdRef.current === id) {
        setBacklinks(next);
      }
    } catch {
      if (currentIdRef.current === id) {
        setBacklinks([]);
      }
    } finally {
      if (currentIdRef.current === id) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void refetch(memoryId);
  }, [memoryId, refetch]);

  useEffect(() => {
    const unlisteners: Array<() => void> = [];
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const schedule = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        void refetch(currentIdRef.current);
      }, BACKLINKS_REFRESH_DEBOUNCE_MS);
    };

    const setup = async () => {
      unlisteners.push(await listen("wikilinks-cascade", schedule));
      unlisteners.push(await listen("memory-changed", schedule));
      unlisteners.push(await listen("file-deleted", schedule));
    };

    void setup();

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      for (const fn of unlisteners) fn();
    };
  }, [refetch]);

  const occurrenceCount = useMemo(
    () => backlinks.reduce((sum, item) => sum + item.occurrences.length, 0),
    [backlinks],
  );
  const sourceCount = backlinks.length;
  const isEmpty = !loading && sourceCount === 0;

  return (
    <div className="space-y-2 pt-1">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-[color:var(--text-2)] transition-colors hover:text-[color:var(--text-1)]"
      >
        <ChevronRight
          className={clsx(
            "h-3 w-3 shrink-0 transition-transform",
            open && "rotate-90",
          )}
        />
        <span>{t("memoryEditor.links.backlinksTitle")}</span>
        {sourceCount > 0 && (
          <span className="ml-auto rounded-full border border-[var(--border)] bg-[color:var(--bg-2)] px-1.5 py-[1px] text-[9px] font-medium normal-case tracking-normal text-[color:var(--text-1)]">
            {sourceCount} · {occurrenceCount}
          </span>
        )}
      </button>
      {open && (
        <div className="space-y-2">
          <p className="text-[10px] leading-4 text-[color:var(--text-2)]">
            {t("memoryEditor.links.backlinksHint")}
          </p>
          {loading && sourceCount === 0 && (
            <p className="rounded-md border border-[var(--border)] bg-[color:var(--bg-2)] px-2.5 py-2 text-xs text-[color:var(--text-2)]">
              {t("memoryEditor.links.backlinksLoading")}
            </p>
          )}
          {isEmpty && (
            <p className="rounded-md border border-[var(--border)] bg-[color:var(--bg-2)] px-2.5 py-2 text-xs text-[color:var(--text-2)]">
              {t("memoryEditor.links.backlinksEmpty")}
            </p>
          )}
          {backlinks.map((backlink) => (
            <BacklinkCard
              key={backlink.source_id}
              backlink={backlink}
              onOpenMemory={onOpenMemory}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function BacklinkCard({
  backlink,
  onOpenMemory,
}: {
  backlink: BacklinkRef;
  onOpenMemory: (id: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <button
      type="button"
      onClick={() => onOpenMemory(backlink.source_id)}
      className="w-full rounded-md border border-[var(--border)] bg-[color:var(--bg-2)] px-2.5 py-2 text-left transition-colors hover:bg-[color:var(--bg-3)]"
    >
      <p className="truncate text-xs font-semibold text-[color:var(--text-0)]">
        {backlink.source_id}
      </p>
      {backlink.source_l0 && backlink.source_l0 !== backlink.source_id && (
        <p className="mt-0.5 truncate text-[11px] text-[color:var(--text-2)]">
          {backlink.source_l0}
        </p>
      )}
      <ul className="mt-1.5 space-y-1">
        {backlink.occurrences.map((occ, idx) => (
          <li
            key={`${occ.level}-${occ.line}-${idx}`}
            className="flex items-start gap-1.5 text-[11px] leading-4 text-[color:var(--text-1)]"
          >
            <span
              className="shrink-0 rounded bg-[color:var(--bg-3)] px-1 py-[1px] font-mono text-[9px] uppercase tracking-wide text-[color:var(--text-2)]"
              title={t("memoryEditor.links.backlinksLineLabel", { line: occ.line })}
            >
              {occ.level}:{occ.line}
            </span>
            <span className="break-words">{occ.excerpt}</span>
          </li>
        ))}
      </ul>
    </button>
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
  const { t } = useTranslation();

  return (
    <div className="space-y-2">
      <p className="text-[10px] uppercase tracking-[0.12em] text-[color:var(--text-2)]">{title}</p>
      {links.length === 0 && (
        <p className="rounded-md border border-[var(--border)] bg-[color:var(--bg-2)] px-2.5 py-2 text-xs text-[color:var(--text-2)]">
          {t("memoryEditor.links.noLinks")}
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
  const { t } = useTranslation();

  return (
    <div className="space-y-2 p-3">
      {dirty && (
        <div className="rounded-md border border-[var(--border)] bg-[color:var(--bg-2)] px-2.5 py-2 text-xs text-[color:var(--text-1)]">
          {t("memoryEditor.history.pendingSync")}
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

function formatTimestamp(value: string, t: TFunction): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return t("memoryEditor.history.notAvailable");
  return date.toLocaleString();
}

function rewriteWikilinkText(body: string, rawText: string, newId: string): string {
  const escaped = rawText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`\\[\\[\\s*${escaped}\\s*\\]\\]`, "g");
  return body.replace(pattern, `[[${newId}]]`);
}

function filterTransientWikilinkWarnings(
  warnings: WikilinkSaveWarning[],
  pendingCreations: ReadonlySet<string>,
) {
  return warnings.filter(
    (warning) => !(warning.kind === "unresolved" && pendingCreations.has(warning.text)),
  );
}

function upsertMemoryMeta(memories: MemoryMeta[], nextMeta: MemoryMeta) {
  const existingIndex = memories.findIndex((memory) => memory.id === nextMeta.id);
  if (existingIndex === -1) {
    return [...memories, nextMeta].sort((a, b) => a.id.localeCompare(b.id));
  }

  const next = [...memories];
  next[existingIndex] = nextMeta;
  return next;
}

function useStableWikilinkTargets(memories: ReadonlyArray<MemoryMeta>) {
  const cacheRef = useRef<{ signature: string; targets: WikilinkTarget[] }>({
    signature: "",
    targets: [],
  });

  return useMemo(() => {
    const signature = memories
      .map(
        (memory) =>
          `${memory.id}\u0000${memory.l0}\u0000${memory.type}\u0000${memory.folder_category ?? ""}`,
      )
      .join("\u0001");

    if (cacheRef.current.signature === signature) {
      return cacheRef.current.targets;
    }

    const targets = memories.map((memory) => ({
      id: memory.id,
      l0: memory.l0,
      ontology: memory.type,
      folderCategory: memory.folder_category,
    }));

    cacheRef.current = { signature, targets };
    return targets;
  }, [memories]);
}

function collectMemoryDirectoryOptions(fileTree: ReadonlyArray<FileNode>): MemoryDirectoryOption[] {
  const rootPath = getWorkspaceRootPath(fileTree);
  const options: MemoryDirectoryOption[] = [];
  const seen = new Set<string>();

  const pushOption = (path: string) => {
    if (seen.has(path) || !canStoreMemoryInDirectoryPath(path)) {
      return;
    }
    seen.add(path);
    options.push({
      path,
      label: formatMemoryDirectoryLabel(path, rootPath),
    });
  };

  if (rootPath) {
    pushOption(rootPath);
  }

  const visit = (nodes: ReadonlyArray<FileNode>) => {
    for (const node of nodes) {
      if (!node.is_dir) continue;
      pushOption(node.path);
      visit(node.children);
    }
  };

  visit(fileTree);
  return options;
}

function getPreferredMemoryDirectory(
  activeFilePath: string | null | undefined,
  options: ReadonlyArray<MemoryDirectoryOption>,
) {
  const currentDirectory = getMemoryParentDirectory(activeFilePath);
  if (currentDirectory && options.some((option) => option.path === currentDirectory)) {
    return currentDirectory;
  }
  return options[0]?.path ?? null;
}

function getWorkspaceRootPath(fileTree: ReadonlyArray<FileNode>) {
  const firstPath = fileTree[0]?.path;
  return firstPath ? getMemoryParentDirectory(firstPath) : null;
}

function formatMemoryDirectoryLabel(path: string, rootPath: string | null) {
  const normalizedPath = normalizePathForComparison(path);
  const normalizedRoot = rootPath ? normalizePathForComparison(rootPath) : null;

  if (normalizedRoot && normalizedPath === normalizedRoot) {
    return "/";
  }

  if (normalizedRoot && normalizedPath.startsWith(`${normalizedRoot}/`)) {
    return normalizedPath.slice(normalizedRoot.length + 1);
  }

  return normalizedPath;
}

function canStoreMemoryInDirectoryPath(path: string) {
  const segments = pathSegments(path);
  if (segments.includes("inbox") || segments.includes("sources")) {
    return false;
  }

  const aiIndex = segments.indexOf(".ai");
  return aiIndex === -1;
}

function pathSegments(path: string) {
  return normalizePathForComparison(path).split("/").filter(Boolean);
}

function normalizePathForComparison(path: string) {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

function defaultOntologyForDirectory(path: string): Exclude<MemoryOntology, "unknown"> {
  const normalized = normalizePathForComparison(path);
  if (normalized.includes("/sources") || normalized.endsWith("/sources")) {
    return "source";
  }
  if (
    normalized.includes("/.ai/skills")
    || normalized.endsWith("/.ai/skills")
    || normalized.includes("/.ai/rules")
    || normalized.endsWith("/.ai/rules")
  ) {
    return "concept";
  }
  return "entity";
}

function getMemoryParentDirectory(filePath?: string | null) {
  if (!filePath) return null;
  const normalized = filePath.replace(/[\\/]+$/, "");
  const separatorIndex = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  if (separatorIndex < 0) {
    return null;
  }
  if (separatorIndex === 0) {
    return normalized.slice(0, 1);
  }
  return normalized.slice(0, separatorIndex);
}

type GroupedWarning = {
  key: string;
  level: "l1" | "l2";
  text: string;
  kind: "ambiguous" | "unresolved";
  candidates: WikilinkCandidate[];
  occurrences: number;
  representative: WikilinkSaveWarning;
};

function groupWikilinkWarnings(warnings: WikilinkSaveWarning[]): GroupedWarning[] {
  const byKey = new Map<string, GroupedWarning>();
  for (const warning of warnings) {
    const key = `${warning.level}::${warning.text}::${warning.kind}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.occurrences += 1;
      continue;
    }
    byKey.set(key, {
      key,
      level: warning.level,
      text: warning.text,
      kind: warning.kind,
      candidates: warning.candidates ?? [],
      occurrences: 1,
      representative: warning,
    });
  }
  return Array.from(byKey.values());
}

function WikilinkWarningsBanner({
  warnings,
  collapsed,
  onToggleCollapsed,
  onPickCandidate,
  onCreateMemory,
}: {
  warnings: WikilinkSaveWarning[];
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onPickCandidate: (warning: WikilinkSaveWarning, candidateId: string) => void;
  onCreateMemory: (warning: WikilinkSaveWarning) => void;
}) {
  const { t } = useTranslation();
  const grouped = useMemo(() => groupWikilinkWarnings(warnings), [warnings]);
  const totalCount = warnings.length;

  return (
    <div className="mb-3 rounded-lg border border-[color:var(--warning)]/40 bg-[color:var(--warning)]/5 px-3 py-2 text-[11px] text-[color:var(--text-1)]">
      <button
        type="button"
        onClick={onToggleCollapsed}
        className="flex w-full items-center gap-2 text-left"
      >
        <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-[color:var(--warning)]" />
        <span className="font-semibold text-[color:var(--warning)]">
          {t("memoryEditor.warnings.title")}
        </span>
        <span className="rounded-full border border-[color:var(--warning)]/40 bg-[color:var(--warning)]/10 px-1.5 py-[1px] text-[10px] font-medium text-[color:var(--warning)]">
          {totalCount}
        </span>
        <span className="ml-auto text-[10px] uppercase tracking-[0.12em] text-[color:var(--text-2)]">
          {collapsed
            ? t("memoryEditor.warnings.show", { count: totalCount })
            : t("memoryEditor.warnings.hide")}
        </span>
        <ChevronRight
          className={clsx(
            "h-3 w-3 shrink-0 text-[color:var(--text-2)] transition-transform",
            !collapsed && "rotate-90",
          )}
        />
      </button>
      {!collapsed && (
        <>
          <p className="mt-2 text-[10px] leading-4 text-[color:var(--text-2)]">
            {t("memoryEditor.warnings.hint")}
          </p>
          <ul className="mt-2 space-y-2">
            {grouped.map((group) => (
              <WarningRow
                key={group.key}
                group={group}
                onPickCandidate={onPickCandidate}
                onCreateMemory={onCreateMemory}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function WarningRow({
  group,
  onPickCandidate,
  onCreateMemory,
}: {
  group: GroupedWarning;
  onPickCandidate: (warning: WikilinkSaveWarning, candidateId: string) => void;
  onCreateMemory: (warning: WikilinkSaveWarning) => void;
}) {
  const { t } = useTranslation();
  const pillClass =
    group.kind === "ambiguous"
      ? "bg-[color:var(--warning)]/20 text-[color:var(--warning)]"
      : "bg-[color:var(--danger)]/20 text-[color:var(--danger)]";
  return (
    <li className="rounded-md border border-[color:var(--border)] bg-[color:var(--bg-1)] px-2 py-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span
          className={clsx(
            "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
            pillClass,
          )}
        >
          {group.kind === "ambiguous"
            ? t("memoryEditor.warnings.ambiguous")
            : t("memoryEditor.warnings.unresolved")}
        </span>
        <span className="rounded bg-[color:var(--bg-3)] px-1.5 py-0.5 font-mono text-[10px] text-[color:var(--text-2)]">
          {group.level.toUpperCase()}
        </span>
        <code className="truncate font-mono text-[11px] text-[color:var(--text-0)]">
          [[{group.text}]]
        </code>
        {group.occurrences > 1 && (
          <span className="text-[10px] text-[color:var(--text-2)]">
            ×{group.occurrences}
          </span>
        )}
      </div>
      {group.kind === "ambiguous" && group.candidates.length > 0 && (
        <div className="mt-1.5 space-y-1">
          <p className="text-[10px] uppercase tracking-[0.12em] text-[color:var(--text-2)]">
            {t("memoryEditor.warnings.pickCandidate")}
          </p>
          <div className="flex flex-wrap gap-1">
            {group.candidates.map((candidate) => (
              <button
                key={candidate.id}
                type="button"
                onClick={() => onPickCandidate(group.representative, candidate.id)}
                className="inline-flex items-center gap-1 rounded border border-[color:var(--border)] bg-[color:var(--bg-2)] px-1.5 py-0.5 text-[11px] text-[color:var(--text-1)] transition-colors hover:border-[color:var(--accent)] hover:text-[color:var(--accent)]"
              >
                <span className="font-mono">{candidate.id}</span>
                {candidate.l0 && candidate.l0 !== candidate.id && (
                  <span className="text-[color:var(--text-2)]">· {candidate.l0}</span>
                )}
                <span className="rounded bg-[color:var(--bg-3)] px-1 py-[1px] text-[9px] uppercase tracking-wide text-[color:var(--text-2)]">
                  {candidate.match_type === "exact_l0"
                    ? t("memoryEditor.warnings.matchExact")
                    : t("memoryEditor.warnings.matchFuzzy")}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
      {group.kind === "unresolved" && (
        <div className="mt-1.5">
          <button
            type="button"
            onClick={() => onCreateMemory(group.representative)}
            className="inline-flex items-center gap-1.5 rounded border border-[color:var(--border)] bg-[color:var(--bg-2)] px-2 py-0.5 text-[11px] text-[color:var(--text-1)] transition-colors hover:border-[color:var(--accent)] hover:text-[color:var(--accent)]"
          >
            <Plus className="h-3 w-3" />
            {t("memoryEditor.warnings.createMemory")}
          </button>
        </div>
      )}
    </li>
  );
}

function BrokenLinkCreateDialog({
  text,
  suggestedDraft,
  targets,
  directoryOptions,
  defaultDirectory,
  onCancel,
  onConfirm,
}: {
  text: string;
  suggestedDraft: WikilinkDraftMemory;
  targets: ReadonlyArray<WikilinkTarget>;
  directoryOptions: ReadonlyArray<MemoryDirectoryOption>;
  defaultDirectory: string | null;
  onCancel: () => void;
  onConfirm: (draft: {
    id: string;
    l0: string;
    ontology: MemoryOntology;
    directory: string;
  }) => void;
}) {
  const { t } = useTranslation();
  const [l0, setL0] = useState(suggestedDraft.l0);
  const [id, setId] = useState(() =>
    suggestedDraft.id,
  );
  const [idTouched, setIdTouched] = useState(false);
  const [selectedDirectory, setSelectedDirectory] = useState(defaultDirectory ?? "");
  const [ontology, setOntology] = useState<MemoryOntology>(
    defaultDirectory ? defaultOntologyForDirectory(defaultDirectory) : "unknown",
  );
  const [ontologyTouched, setOntologyTouched] = useState(false);

  useEffect(() => {
    if (!idTouched) {
      setId(nextUniqueMemoryId(l0 || suggestedDraft.l0, targets));
    }
  }, [l0, suggestedDraft.l0, targets, idTouched]);

  useEffect(() => {
    if (!ontologyTouched && selectedDirectory) {
      setOntology(defaultOntologyForDirectory(selectedDirectory));
    }
  }, [selectedDirectory, ontologyTouched]);

  const hasCollision = useMemo(
    () => targets.some((target) => target.id === id.trim()),
    [targets, id],
  );
  const trimmedId = id.trim();
  const trimmedL0 = l0.trim();
  const canConfirm =
    trimmedId.length > 0
    && trimmedL0.length > 0
    && selectedDirectory.length > 0
    && !hasCollision;

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onCancel]);

  const handleBackdropClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) onCancel();
  };

  return (
    <div
      className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onMouseDown={handleBackdropClick}
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-md rounded-lg border border-[color:var(--border)] bg-[color:var(--bg-1)] p-5 shadow-xl">
        <div className="mb-3 flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-[color:var(--accent-muted)]">
            <Link2Off className="h-4 w-4 text-[color:var(--accent)]" />
          </div>
          <h2 className="text-sm font-semibold text-[color:var(--text-0)]">
            {t("memoryEditor.brokenLink.title", { text })}
          </h2>
          <button
            type="button"
            onClick={onCancel}
            className="ml-auto rounded p-1 text-[color:var(--text-2)] transition-colors hover:text-[color:var(--text-0)]"
            aria-label={t("memoryEditor.brokenLink.cancel")}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <p className="mb-3 text-xs leading-5 text-[color:var(--text-2)]">
          {t("memoryEditor.brokenLink.description")}
        </p>

        <div className="space-y-2">
          <label className="block space-y-1">
            <span className="text-[10px] uppercase tracking-[0.12em] text-[color:var(--text-2)]">
              {t("memoryEditor.brokenLink.l0Label")}
            </span>
            <input
              type="text"
              value={l0}
              onChange={(event) => setL0(event.target.value)}
              autoFocus
              className="w-full rounded-md border border-[var(--border)] bg-[color:var(--bg-2)] px-2 py-1.5 text-xs text-[color:var(--text-0)]"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-[10px] uppercase tracking-[0.12em] text-[color:var(--text-2)]">
              {t("memoryEditor.brokenLink.idLabel")}
            </span>
            <input
              type="text"
              value={id}
              onChange={(event) => {
                setIdTouched(true);
                setId(slugifyMemoryId(event.target.value));
              }}
              className={clsx(
                "w-full rounded-md border bg-[color:var(--bg-2)] px-2 py-1.5 font-mono text-xs text-[color:var(--text-0)]",
                hasCollision
                  ? "border-[color:var(--danger)]"
                  : "border-[var(--border)]",
              )}
            />
            {hasCollision && (
              <p className="text-[10px] text-[color:var(--danger)]">
                {t("memoryEditor.brokenLink.idCollision")}
              </p>
            )}
          </label>
          <label className="block space-y-1">
            <span className="text-[10px] uppercase tracking-[0.12em] text-[color:var(--text-2)]">
              {t("memoryEditor.brokenLink.ontologyLabel")}
            </span>
            <select
              value={ontology}
              onChange={(event) => {
                setOntologyTouched(true);
                setOntology(event.target.value as MemoryOntology);
              }}
              className="w-full rounded-md border border-[var(--border)] bg-[color:var(--bg-2)] px-2 py-1.5 text-xs text-[color:var(--text-1)]"
            >
              {(["unknown", "source", "entity", "concept", "synthesis"] as MemoryOntology[]).map(
                (value) => (
                  <option key={value} value={value}>
                    {t(`ontologies.${value}`)}
                  </option>
                ),
              )}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-[10px] uppercase tracking-[0.12em] text-[color:var(--text-2)]">
              {t("memoryEditor.brokenLink.folderLabel")}
            </span>
            <select
              value={selectedDirectory}
              onChange={(event) => setSelectedDirectory(event.target.value)}
              className="w-full rounded-md border border-[var(--border)] bg-[color:var(--bg-2)] px-2 py-1.5 text-xs text-[color:var(--text-1)]"
            >
              <option value="">
                {t("memoryEditor.brokenLink.folderPlaceholder")}
              </option>
              {directoryOptions.map((option) => (
                <option key={option.path} value={option.path}>
                  {option.label}
                </option>
              ))}
            </select>
            {!selectedDirectory && (
              <p className="text-[10px] text-[color:var(--danger)]">
                {t("memoryEditor.brokenLink.folderRequired")}
              </p>
            )}
          </label>
        </div>

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-md border border-[color:var(--border)] bg-[color:var(--bg-2)] px-4 py-1.5 text-xs font-medium text-[color:var(--text-1)] transition-colors hover:border-[color:var(--border-active)]"
          >
            {t("memoryEditor.brokenLink.cancel")}
          </button>
          <button
            type="button"
            disabled={!canConfirm}
            onClick={() =>
              onConfirm({
                id: trimmedId,
                l0: trimmedL0,
                ontology,
                directory: selectedDirectory,
              })
            }
            className="flex-1 rounded-md bg-[color:var(--accent)] px-4 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t("memoryEditor.brokenLink.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}

function SaveStateBadge({ status }: { status: SaveStatus }) {
  const { t } = useTranslation();
  const label =
    status === "saving"
      ? t("memoryEditor.saveStatus.saving")
      : status === "error"
        ? t("memoryEditor.saveStatus.error")
        : status === "dirty"
          ? t("memoryEditor.saveStatus.pending")
          : t("memoryEditor.saveStatus.saved");

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
          <span>{lineCount} lines</span>
          {file.kind === "jsonl" && (
            <>
              <span>·</span>
              <span>{records.length} records</span>
              <span>·</span>
              <span>{parsedCount} valid</span>
              {errorCount > 0 && (
                <>
                  <span>·</span>
                  <span>{errorCount} errors</span>
                </>
              )}
            </>
          )}
          <span>·</span>
          <span>{dirty ? "pending" : "synced"}</span>
        </div>

        <RawSyntaxEditor
          value={content}
          onChange={(value) => {
            setContent(value);
            setSaveStatus("dirty");
          }}
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
        error: `Error parsing JSON: ${String(e)}`,
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
    ontology: meta.type,
    l0: meta.l0,
    importance: meta.importance,
    decay_rate: meta.decay_rate,
    confidence: meta.confidence,
    tags: meta.tags,
    related: meta.related,
    triggers: meta.triggers,
    requires: meta.requires,
    optional: meta.optional,
    output_format: meta.output_format,
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
