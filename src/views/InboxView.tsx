import { listen } from "@tauri-apps/api/event";
import { clsx } from "clsx";
import {
  Bot,
  Check,
  FilePlus2,
  FolderSearch,
  Inbox as InboxIcon,
  Link2,
  Loader2,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
  Wand2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { HybridMarkdownEditor } from "../components/editor/HybridMarkdownEditor";
import { useAppStore } from "../lib/store";
import {
  applyIngestProposal,
  createInboxLink,
  createInboxText,
  generateIngestProposals,
  listInboxItems,
  listIngestProposals,
  normalizeInboxItem,
  rejectIngestProposal,
  updateInboxItem,
} from "../lib/tauri";
import type { IngestProposal, InboxItem } from "../lib/types";

type QueueFilter = "review" | "pending" | "resolved" | "all";
type CaptureMode = "note" | "link" | null;
type LayoutMode = "stack" | "split" | "wide";
type StackPanel = "queue" | "item" | "recommendation";
type DetailPanel = "item" | "recommendation";
type ItemEditorTab = "details" | "l1" | "l2";

function actionLabel(action: IngestProposal["action"]) {
  switch (action) {
    case "promote_memory":
      return "Promote memory";
    case "route_to_sources":
      return "Route to sources";
    case "update_memory":
      return "Update memory";
    case "discard":
      return "Discard";
    case "needs_review":
      return "Needs review";
    default:
      return action;
  }
}

function parseTagInput(raw: string): string[] {
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function useInboxLayoutMode() {
  const [layoutMode, setLayoutMode] = useState<LayoutMode>(() => {
    if (typeof window === "undefined") return "wide";
    if (window.innerWidth >= 1536) return "wide";
    if (window.innerWidth >= 1024) return "split";
    return "stack";
  });

  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth >= 1536) {
        setLayoutMode("wide");
      } else if (window.innerWidth >= 1024) {
        setLayoutMode("split");
      } else {
        setLayoutMode("stack");
      }
    };

    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return layoutMode;
}

function buildProposalMap(proposals: IngestProposal[]) {
  const grouped = new Map<string, IngestProposal[]>();
  for (const proposal of proposals) {
    const bucket = grouped.get(proposal.item_id) ?? [];
    bucket.push(proposal);
    grouped.set(proposal.item_id, bucket);
  }

  const resolved = new Map<string, IngestProposal>();
  for (const [itemId, bucket] of grouped.entries()) {
    const ordered = [...bucket].sort((left, right) => right.modified.localeCompare(left.modified));
    resolved.set(
      itemId,
      ordered.find((proposal) => proposal.state === "pending") ?? ordered[0],
    );
  }

  return resolved;
}

function queueBucket(item: InboxItem, proposal: IngestProposal | null): QueueFilter {
  if (proposal?.state === "pending") return "review";
  if (proposal?.state === "applied" || proposal?.state === "rejected") return "resolved";
  if (item.status === "processed" || item.status === "promoted" || item.status === "discarded") {
    return "resolved";
  }
  return "pending";
}

function bucketLabel(bucket: QueueFilter) {
  switch (bucket) {
    case "review":
      return "Ready for review";
    case "pending":
      return "Pending analysis";
    case "resolved":
      return "Resolved";
    case "all":
      return "All";
    default:
      return bucket;
  }
}

function statusTone(item: InboxItem, proposal: IngestProposal | null) {
  const bucket = queueBucket(item, proposal);
  if (bucket === "review") return "text-[color:var(--warning)] bg-[color:var(--warning)]/10";
  if (bucket === "resolved") return "text-[color:var(--success)] bg-[color:var(--success)]/10";
  return "text-[color:var(--accent)] bg-[color:var(--accent-muted)]";
}

export function InboxView() {
  const setError = useAppStore((state) => state.setError);
  const loadMemories = useAppStore((state) => state.loadMemories);
  const loadFileTree = useAppStore((state) => state.loadFileTree);
  const loadGraph = useAppStore((state) => state.loadGraph);

  const layoutMode = useInboxLayoutMode();
  const [items, setItems] = useState<InboxItem[]>([]);
  const [proposals, setProposals] = useState<IngestProposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [filter, setFilter] = useState<QueueFilter>("review");
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [captureMode, setCaptureMode] = useState<CaptureMode>(null);
  const [stackPanel, setStackPanel] = useState<StackPanel>("queue");
  const [detailPanel, setDetailPanel] = useState<DetailPanel>("item");
  const [itemEditorTab, setItemEditorTab] = useState<ItemEditorTab>("details");

  const [draftTitle, setDraftTitle] = useState("");
  const [draftL1, setDraftL1] = useState("");
  const [draftL2, setDraftL2] = useState("");
  const [draftTags, setDraftTags] = useState("");
  const [applyDestination, setApplyDestination] = useState("");

  const [noteTitle, setNoteTitle] = useState("");
  const [noteContent, setNoteContent] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkTitle, setLinkTitle] = useState("");
  const [linkNotes, setLinkNotes] = useState("");

  const refreshDerivedState = useCallback(async () => {
    await Promise.all([loadMemories(), loadFileTree(), loadGraph()]);
  }, [loadFileTree, loadGraph, loadMemories]);

  const loadInboxState = useCallback(async () => {
    try {
      setLoading(true);
      const [nextItems, nextProposals] = await Promise.all([
        listInboxItems(),
        listIngestProposals(),
      ]);
      setItems(nextItems);
      setProposals(nextProposals);
      setSelectedItemId((current) => {
        if (current && nextItems.some((item) => item.id === current)) return current;
        return nextItems[0]?.id ?? null;
      });
    } catch (error) {
      setError(String(error));
    } finally {
      setLoading(false);
    }
  }, [setError]);

  useEffect(() => {
    void loadInboxState();
  }, [loadInboxState]);

  useEffect(() => {
    let disposeInbox: (() => void) | undefined;
    let disposeProposals: (() => void) | undefined;

    void listen("inbox-changed", () => {
      void loadInboxState();
    }).then((unlisten) => {
      disposeInbox = unlisten;
    });

    void listen("proposals-changed", () => {
      void loadInboxState();
    }).then((unlisten) => {
      disposeProposals = unlisten;
    });

    return () => {
      disposeInbox?.();
      disposeProposals?.();
    };
  }, [loadInboxState]);

  const proposalMap = useMemo(() => buildProposalMap(proposals), [proposals]);

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (filter === "all") return true;
      return queueBucket(item, proposalMap.get(item.id) ?? null) === filter;
    });
  }, [filter, items, proposalMap]);

  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedItemId) ?? filteredItems[0] ?? items[0] ?? null,
    [filteredItems, items, selectedItemId],
  );

  const selectedProposal = useMemo(
    () => (selectedItem ? proposalMap.get(selectedItem.id) ?? null : null),
    [proposalMap, selectedItem],
  );

  useEffect(() => {
    if (!selectedItem) {
      if (layoutMode === "stack") setStackPanel("queue");
      return;
    }
    setSelectedItemId(selectedItem.id);
  }, [layoutMode, selectedItem]);

  useEffect(() => {
    if (!selectedItem) return;
    setDraftTitle(selectedItem.title);
    setDraftL1(selectedItem.l1_content);
    setDraftL2(selectedItem.l2_content);
    setDraftTags(selectedItem.tags.join(", "));
  }, [selectedItem?.id]);

  useEffect(() => {
    if (!selectedProposal) {
      setApplyDestination("");
      return;
    }
    setApplyDestination(
      selectedProposal.destination ?? selectedProposal.destination_candidates[0]?.path ?? "",
    );
  }, [selectedProposal?.id]);

  const focusItemPanel = useCallback(() => {
    if (layoutMode === "stack") {
      setStackPanel("item");
    } else if (layoutMode === "split") {
      setDetailPanel("item");
    }
  }, [layoutMode]);

  const focusRecommendationPanel = useCallback(() => {
    if (layoutMode === "stack") {
      setStackPanel("recommendation");
    } else if (layoutMode === "split") {
      setDetailPanel("recommendation");
    }
  }, [layoutMode]);

  const handleSelectItem = useCallback(
    (itemId: string) => {
      setSelectedItemId(itemId);
      focusItemPanel();
    },
    [focusItemPanel],
  );

  const currentBucket = selectedItem ? queueBucket(selectedItem, selectedProposal) : "pending";
  const draftIsDirty =
    !!selectedItem &&
    (draftTitle !== selectedItem.title ||
      draftL1 !== selectedItem.l1_content ||
      draftL2 !== selectedItem.l2_content ||
      draftTags !== selectedItem.tags.join(", "));

  const refreshAfterMutation = useCallback(async () => {
    await loadInboxState();
    await refreshDerivedState();
  }, [loadInboxState, refreshDerivedState]);

  const saveSelectedItem = useCallback(async () => {
    if (!selectedItem || !draftIsDirty) return selectedItem;
    setBusyAction("save-item");
    try {
      const updated = await updateInboxItem({
        id: selectedItem.id,
        title: draftTitle,
        l1_content: draftL1,
        l2_content: draftL2,
        tags: parseTagInput(draftTags),
      });
      await loadInboxState();
      setSelectedItemId(updated.id);
      return updated;
    } catch (error) {
      setError(String(error));
      return null;
    } finally {
      setBusyAction(null);
    }
  }, [
    draftIsDirty,
    draftL1,
    draftL2,
    draftTags,
    draftTitle,
    loadInboxState,
    selectedItem,
    setError,
  ]);

  const handleAnalyzeItem = useCallback(
    async (mode: "generate" | "replace") => {
      if (!selectedItem) return;
      const saved = await saveSelectedItem();
      if (!saved) return;

      setBusyAction(mode === "replace" ? "replace-proposal" : "generate-proposal");
      try {
        if (mode === "replace" && selectedProposal?.state === "pending") {
          await rejectIngestProposal(selectedProposal.id);
        }
        await generateIngestProposals([saved.id]);
        await loadInboxState();
        setSelectedItemId(saved.id);
        focusRecommendationPanel();
      } catch (error) {
        setError(String(error));
      } finally {
        setBusyAction(null);
      }
    },
    [
      focusRecommendationPanel,
      loadInboxState,
      saveSelectedItem,
      selectedItem,
      selectedProposal,
      setError,
    ],
  );

  const handleAnalyzeVisible = useCallback(async () => {
    const ids = filteredItems
      .filter((item) => {
        const proposal = proposalMap.get(item.id) ?? null;
        return !proposal || proposal.state !== "pending";
      })
      .map((item) => item.id);
    if (ids.length === 0) return;
    setBusyAction("generate-visible");
    try {
      await generateIngestProposals(ids);
      await loadInboxState();
    } catch (error) {
      setError(String(error));
    } finally {
      setBusyAction(null);
    }
  }, [filteredItems, loadInboxState, proposalMap, setError]);

  const handleNormalizeSelected = useCallback(async () => {
    if (!selectedItem) return;
    const saved = await saveSelectedItem();
    if (!saved) return;
    setBusyAction("normalize-item");
    try {
      await normalizeInboxItem(saved.id);
      await loadInboxState();
      setSelectedItemId(saved.id);
    } catch (error) {
      setError(String(error));
    } finally {
      setBusyAction(null);
    }
  }, [loadInboxState, saveSelectedItem, selectedItem, setError]);

  const handleApplyProposal = useCallback(async () => {
    if (!selectedProposal) return;
    setBusyAction("apply-proposal");
    try {
      await applyIngestProposal({
        proposal_id: selectedProposal.id,
        destination_dir: selectedProposal.action === "promote_memory" ? applyDestination || null : null,
      });
      await refreshAfterMutation();
      focusRecommendationPanel();
    } catch (error) {
      setError(String(error));
    } finally {
      setBusyAction(null);
    }
  }, [applyDestination, focusRecommendationPanel, refreshAfterMutation, selectedProposal, setError]);

  const handleRejectProposal = useCallback(async () => {
    if (!selectedProposal) return;
    setBusyAction("reject-proposal");
    try {
      await rejectIngestProposal(selectedProposal.id);
      await loadInboxState();
    } catch (error) {
      setError(String(error));
    } finally {
      setBusyAction(null);
    }
  }, [loadInboxState, selectedProposal, setError]);

  const handleCreateNote = useCallback(async () => {
    if (!noteTitle.trim() && !noteContent.trim()) return;
    setBusyAction("create-note");
    try {
      const created = await createInboxText({
        title: noteTitle.trim() || "Inbox note",
        content: noteContent,
      });
      setNoteTitle("");
      setNoteContent("");
      setCaptureMode(null);
      await loadInboxState();
      setSelectedItemId(created.id);
      focusItemPanel();
    } catch (error) {
      setError(String(error));
    } finally {
      setBusyAction(null);
    }
  }, [focusItemPanel, loadInboxState, noteContent, noteTitle, setError]);

  const handleCreateLink = useCallback(async () => {
    if (!linkUrl.trim()) return;
    setBusyAction("create-link");
    try {
      const created = await createInboxLink({
        url: linkUrl.trim(),
        title: linkTitle.trim() || null,
        notes: linkNotes.trim() || null,
      });
      setLinkUrl("");
      setLinkTitle("");
      setLinkNotes("");
      setCaptureMode(null);
      await loadInboxState();
      setSelectedItemId(created.id);
      focusItemPanel();
    } catch (error) {
      setError(String(error));
    } finally {
      setBusyAction(null);
    }
  }, [focusItemPanel, linkNotes, linkTitle, linkUrl, loadInboxState, setError]);

  const counts = useMemo(() => {
    const review = items.filter((item) => queueBucket(item, proposalMap.get(item.id) ?? null) === "review").length;
    const pending = items.filter((item) => queueBucket(item, proposalMap.get(item.id) ?? null) === "pending").length;
    const resolved = items.filter((item) => queueBucket(item, proposalMap.get(item.id) ?? null) === "resolved").length;
    return { review, pending, resolved, all: items.length };
  }, [items, proposalMap]);

  const queuePanel = (
    <div className="flex h-full min-h-0 flex-col bg-[color:var(--bg-1)]">
      <div className="shrink-0 border-b border-[var(--border)] px-4 py-3">
        <div className="mb-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setCaptureMode((current) => (current === "note" ? null : "note"))}
            className={clsx(
              "rounded-md px-3 py-1.5 text-xs font-medium",
              captureMode === "note"
                ? "bg-[color:var(--accent-muted)] text-[color:var(--accent)]"
                : "border border-[var(--border)] text-[color:var(--text-1)] hover:bg-[color:var(--bg-2)]",
            )}
          >
            <span className="inline-flex items-center gap-1.5">
              <FilePlus2 className="h-3.5 w-3.5" />
              Quick note
            </span>
          </button>
          <button
            type="button"
            onClick={() => setCaptureMode((current) => (current === "link" ? null : "link"))}
            className={clsx(
              "rounded-md px-3 py-1.5 text-xs font-medium",
              captureMode === "link"
                ? "bg-[color:var(--accent-muted)] text-[color:var(--accent)]"
                : "border border-[var(--border)] text-[color:var(--text-1)] hover:bg-[color:var(--bg-2)]",
            )}
          >
            <span className="inline-flex items-center gap-1.5">
              <Link2 className="h-3.5 w-3.5" />
              Capture link
            </span>
          </button>
        </div>

        {captureMode === "note" && (
          <div className="space-y-2 rounded-lg border border-[var(--border)] bg-[color:var(--bg-0)] p-3">
            <input
              value={noteTitle}
              onChange={(event) => setNoteTitle(event.target.value)}
              placeholder="Title"
              className="w-full rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-sm text-[color:var(--text-0)] outline-none"
            />
            <textarea
              value={noteContent}
              onChange={(event) => setNoteContent(event.target.value)}
              placeholder="Paste the raw note or snippet here"
              rows={4}
              className="w-full rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-sm text-[color:var(--text-0)] outline-none"
            />
            <button
              type="button"
              onClick={() => void handleCreateNote()}
              disabled={busyAction === "create-note"}
              className="rounded-md bg-[color:var(--accent)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
            >
              {busyAction === "create-note" ? "Creating..." : "Create inbox note"}
            </button>
          </div>
        )}

        {captureMode === "link" && (
          <div className="space-y-2 rounded-lg border border-[var(--border)] bg-[color:var(--bg-0)] p-3">
            <input
              value={linkUrl}
              onChange={(event) => setLinkUrl(event.target.value)}
              placeholder="https://..."
              className="w-full rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-sm text-[color:var(--text-0)] outline-none"
            />
            <input
              value={linkTitle}
              onChange={(event) => setLinkTitle(event.target.value)}
              placeholder="Optional title"
              className="w-full rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-sm text-[color:var(--text-0)] outline-none"
            />
            <textarea
              value={linkNotes}
              onChange={(event) => setLinkNotes(event.target.value)}
              placeholder="Optional notes"
              rows={3}
              className="w-full rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-sm text-[color:var(--text-0)] outline-none"
            />
            <button
              type="button"
              onClick={() => void handleCreateLink()}
              disabled={busyAction === "create-link"}
              className="rounded-md bg-[color:var(--accent)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
            >
              {busyAction === "create-link" ? "Capturing..." : "Create inbox link"}
            </button>
          </div>
        )}
      </div>

      <div className="shrink-0 border-b border-[var(--border)] px-3 py-2">
        <div className="flex gap-1 overflow-x-auto pb-1">
          {(["review", "pending", "resolved", "all"] as QueueFilter[]).map((bucket) => (
            <button
              key={bucket}
              type="button"
              onClick={() => setFilter(bucket)}
              className={clsx(
                "whitespace-nowrap rounded-md px-2.5 py-1.5 text-[11px] font-medium",
                filter === bucket
                  ? "bg-[color:var(--accent-muted)] text-[color:var(--accent)]"
                  : "text-[color:var(--text-2)] hover:bg-[color:var(--bg-2)] hover:text-[color:var(--text-1)]",
              )}
            >
              {bucketLabel(bucket)} ({counts[bucket]})
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {loading ? (
          <div className="flex h-full items-center justify-center text-sm text-[color:var(--text-2)]">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-5 text-center text-sm text-[color:var(--text-2)]">
            <FolderSearch className="h-5 w-5 text-[color:var(--text-2)]" />
            No items in this bucket.
          </div>
        ) : (
          <div className="space-y-2">
            {filteredItems.map((item) => {
              const proposal = proposalMap.get(item.id) ?? null;
              const bucket = queueBucket(item, proposal);
              const isSelected = selectedItem?.id === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleSelectItem(item.id)}
                  className={clsx(
                    "w-full rounded-xl border p-3 text-left transition-colors",
                    isSelected
                      ? "border-[color:var(--accent)] bg-[color:var(--accent-muted)]/50"
                      : "border-[var(--border)] bg-[color:var(--bg-0)] hover:bg-[color:var(--bg-2)]",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-[color:var(--text-0)]">
                        {item.title}
                      </div>
                      <div className="mt-1 line-clamp-2 text-xs text-[color:var(--text-2)]">
                        {item.summary || item.l1_content || item.l2_content || "No preview yet"}
                      </div>
                    </div>
                    <span
                      className={clsx(
                        "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                        statusTone(item, proposal),
                      )}
                    >
                      {bucketLabel(bucket)}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-[color:var(--text-2)]">
                    <span>{item.kind}</span>
                    <span>•</span>
                    <span>{item.status}</span>
                    {proposal && (
                      <>
                        <span>•</span>
                        <span>{actionLabel(proposal.action)}</span>
                      </>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );

  const itemPanel = (
    <div className="flex h-full min-h-0 flex-col bg-[color:var(--bg-0)]">
      {!selectedItem ? (
        <div className="flex h-full items-center justify-center text-sm text-[color:var(--text-2)]">
          Select an inbox item to start reviewing it.
        </div>
      ) : (
        <>
          <div className="shrink-0 border-b border-[var(--border)] px-4 py-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-[15px] font-semibold text-[color:var(--text-0)]">
                  {draftTitle || selectedItem.title}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-[color:var(--text-2)]">
                  <span>{selectedItem.kind}</span>
                  <span>•</span>
                  <span>{selectedItem.path.split("/").pop()}</span>
                  <span>•</span>
                  <span>{bucketLabel(currentBucket)}</span>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void saveSelectedItem()}
                  disabled={!draftIsDirty || busyAction === "save-item"}
                  className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs text-[color:var(--text-1)] disabled:opacity-50"
                >
                  <span className="inline-flex items-center gap-1.5">
                    {busyAction === "save-item" ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Save className="h-3.5 w-3.5" />
                    )}
                    Save item
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => void handleNormalizeSelected()}
                  disabled={busyAction === "normalize-item"}
                  className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs text-[color:var(--text-1)] disabled:opacity-50"
                >
                  <span className="inline-flex items-center gap-1.5">
                    {busyAction === "normalize-item" ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Wand2 className="h-3.5 w-3.5" />
                    )}
                    Normalize
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void handleAnalyzeItem(selectedProposal?.state === "pending" ? "replace" : "generate")
                  }
                  disabled={busyAction === "generate-proposal" || busyAction === "replace-proposal"}
                  className="rounded-md bg-[color:var(--accent)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
                >
                  <span className="inline-flex items-center gap-1.5">
                    {busyAction === "generate-proposal" || busyAction === "replace-proposal" ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Bot className="h-3.5 w-3.5" />
                    )}
                    {selectedProposal?.state === "pending"
                      ? "Replace recommendation"
                      : "Generate recommendation"}
                  </span>
                </button>
              </div>
            </div>
          </div>

          {layoutMode === "wide" ? (
            <div className="grid min-h-0 flex-1 grid-cols-1 gap-px bg-[var(--border)] lg:grid-cols-[280px_minmax(0,1fr)]">
              <div className="min-h-0 overflow-y-auto bg-[color:var(--bg-1)] p-4">
                <ItemDetailsFields
                  selectedItem={selectedItem}
                  draftTitle={draftTitle}
                  draftTags={draftTags}
                  setDraftTitle={setDraftTitle}
                  setDraftTags={setDraftTags}
                />
              </div>

              <div className="grid min-h-0 grid-rows-[minmax(220px,1fr)_minmax(220px,1fr)]">
                <EditorCard
                  title="L1 summary"
                  content={draftL1}
                  onChange={setDraftL1}
                  placeholder="Short structured summary of the inbox item"
                />
                <EditorCard
                  title="L2 details"
                  content={draftL2}
                  onChange={setDraftL2}
                  placeholder="Longer notes, raw content, citations, or extracted detail"
                  bordered
                />
              </div>
            </div>
          ) : (
            <>
              <div className="shrink-0 border-b border-[var(--border)] px-3 py-2">
                <SegmentedControl
                  value={itemEditorTab}
                  onChange={(value) => setItemEditorTab(value as ItemEditorTab)}
                  options={[
                    { value: "details", label: "Details" },
                    { value: "l1", label: "L1" },
                    { value: "l2", label: "L2" },
                  ]}
                />
              </div>
              <div className="min-h-0 flex-1">
                {itemEditorTab === "details" && (
                  <div className="h-full overflow-y-auto bg-[color:var(--bg-1)] p-4">
                    <ItemDetailsFields
                      selectedItem={selectedItem}
                      draftTitle={draftTitle}
                      draftTags={draftTags}
                      setDraftTitle={setDraftTitle}
                      setDraftTags={setDraftTags}
                    />
                  </div>
                )}
                {itemEditorTab === "l1" && (
                  <div className="h-full p-4">
                    <div className="h-full rounded-xl border border-[var(--border)] bg-[color:var(--bg-1)]">
                      <EditorCard
                        title="L1 summary"
                        content={draftL1}
                        onChange={setDraftL1}
                        placeholder="Short structured summary of the inbox item"
                        chrome={false}
                      />
                    </div>
                  </div>
                )}
                {itemEditorTab === "l2" && (
                  <div className="h-full p-4">
                    <div className="h-full rounded-xl border border-[var(--border)] bg-[color:var(--bg-1)]">
                      <EditorCard
                        title="L2 details"
                        content={draftL2}
                        onChange={setDraftL2}
                        placeholder="Longer notes, raw content, citations, or extracted detail"
                        chrome={false}
                      />
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );

  const recommendationPanel = (
    <div className="flex h-full min-h-0 flex-col bg-[color:var(--bg-1)]">
      <div className="shrink-0 border-b border-[var(--border)] px-4 py-3">
        <div className="text-sm font-semibold text-[color:var(--text-0)]">Recommendation</div>
        <p className="mt-1 text-xs text-[color:var(--text-2)]">
          Transparent AI recommendation for this item, including related memories and destination hints.
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {!selectedItem ? (
          <div className="text-sm text-[color:var(--text-2)]">
            Select an item to inspect its recommendation.
          </div>
        ) : !selectedProposal ? (
          <div className="rounded-xl border border-dashed border-[var(--border)] p-4 text-sm text-[color:var(--text-2)]">
            No proposal yet. Normalize or generate a recommendation for this item.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl border border-[var(--border)] bg-[color:var(--bg-0)] p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-[color:var(--text-0)]">
                    {actionLabel(selectedProposal.action)}
                  </div>
                  <div className="mt-1 text-xs text-[color:var(--text-2)]">
                    Confidence {Math.round(selectedProposal.confidence * 100)}% • {selectedProposal.origin}
                  </div>
                </div>
                <span
                  className={clsx(
                    "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                    statusTone(selectedItem, selectedProposal),
                  )}
                >
                  {selectedProposal.state}
                </span>
              </div>
              <p className="mt-3 text-sm leading-6 text-[color:var(--text-1)]">
                {selectedProposal.rationale}
              </p>

              {selectedProposal.action === "promote_memory" &&
                selectedProposal.destination_candidates.length > 0 && (
                  <div className="mt-4">
                    <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-[color:var(--text-2)]">
                      Destination
                    </label>
                    <select
                      value={applyDestination}
                      onChange={(event) => setApplyDestination(event.target.value)}
                      className="w-full rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-sm text-[color:var(--text-0)] outline-none"
                    >
                      {selectedProposal.destination_candidates.map((candidate) => (
                        <option key={candidate.path} value={candidate.path}>
                          {candidate.folder_category ? `${candidate.folder_category} · ` : ""}
                          {candidate.path}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

              {selectedProposal.target_memory_id && (
                <div className="mt-4 rounded-lg bg-[color:var(--bg-1)] p-3 text-xs text-[color:var(--text-1)]">
                  Target memory:{" "}
                  <span className="font-mono text-[color:var(--text-0)]">
                    {selectedProposal.target_memory_id}
                  </span>
                </div>
              )}

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void handleApplyProposal()}
                  disabled={busyAction === "apply-proposal"}
                  className="rounded-md bg-[color:var(--success)]/15 px-3 py-1.5 text-xs font-medium text-[color:var(--success)] disabled:opacity-60"
                >
                  <span className="inline-flex items-center gap-1.5">
                    {busyAction === "apply-proposal" ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Check className="h-3.5 w-3.5" />
                    )}
                    Apply recommendation
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => void handleRejectProposal()}
                  disabled={busyAction === "reject-proposal"}
                  className="rounded-md bg-[color:var(--danger)]/10 px-3 py-1.5 text-xs font-medium text-[color:var(--danger)] disabled:opacity-60"
                >
                  <span className="inline-flex items-center gap-1.5">
                    {busyAction === "reject-proposal" ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                    Reject recommendation
                  </span>
                </button>
              </div>
            </div>

            {selectedProposal.duplicate_candidates.length > 0 && (
              <InsightCard
                title="Duplicate signals"
                items={selectedProposal.duplicate_candidates.map((candidate) => ({
                  key: `${candidate.kind}-${candidate.target_id}`,
                  title: `${candidate.target_title} (${Math.round(candidate.confidence * 100)}%)`,
                  meta: candidate.kind,
                  body: candidate.rationale,
                }))}
              />
            )}

            {selectedProposal.related_memory_candidates.length > 0 && (
              <InsightCard
                title="Related memories"
                items={selectedProposal.related_memory_candidates.map((candidate) => ({
                  key: candidate.memory_id,
                  title: `${candidate.l0} (${Math.round(candidate.final_score * 100)}%)`,
                  meta: `${candidate.memory_id} · ${candidate.ontology}`,
                  body: candidate.reasons.join(" "),
                }))}
              />
            )}

            {selectedProposal.destination_candidates.length > 0 && (
              <InsightCard
                title="Destination candidates"
                items={selectedProposal.destination_candidates.map((candidate) => ({
                  key: candidate.path,
                  title: `${candidate.folder_category ?? "workspace"} (${Math.round(candidate.score * 100)}%)`,
                  meta: candidate.path,
                  body: candidate.reasons.join(" "),
                }))}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-[color:var(--bg-0)]">
      <div className="shrink-0 border-b border-[var(--border)] px-4 py-3 lg:px-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[15px] font-semibold text-[color:var(--text-0)]">
              <InboxIcon className="h-4 w-4 text-[color:var(--accent)]" />
              Inbox
            </div>
            <p className="mt-1 max-w-2xl text-xs text-[color:var(--text-2)]">
              Review new content, inspect the AI recommendation, and decide what becomes canonical knowledge.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void loadInboxState()}
              className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs text-[color:var(--text-1)] hover:bg-[color:var(--bg-2)]"
            >
              <span className="inline-flex items-center gap-1.5">
                <RefreshCw className="h-3.5 w-3.5" />
                Refresh
              </span>
            </button>
            <button
              type="button"
              onClick={() => void handleAnalyzeVisible()}
              disabled={busyAction === "generate-visible"}
              className="rounded-md bg-[color:var(--accent)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
            >
              <span className="inline-flex items-center gap-1.5">
                {busyAction === "generate-visible" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" />
                )}
                Analyze visible queue
              </span>
            </button>
          </div>
        </div>
      </div>

      {layoutMode === "stack" && (
        <div className="shrink-0 border-b border-[var(--border)] px-3 py-2">
          <SegmentedControl
            value={stackPanel}
            onChange={(value) => setStackPanel(value as StackPanel)}
            options={[
              { value: "queue", label: `Queue (${counts.review + counts.pending})` },
              { value: "item", label: "Item" },
              { value: "recommendation", label: "Recommendation" },
            ]}
          />
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-hidden">
        {layoutMode === "wide" && (
          <div className="flex h-full min-h-0 flex-row">
            <aside className="flex w-[320px] shrink-0 border-r border-[var(--border)]">
              {queuePanel}
            </aside>
            <section className="min-h-0 min-w-0 flex-1 border-r border-[var(--border)]">
              {itemPanel}
            </section>
            <aside className="flex w-[380px] shrink-0">{recommendationPanel}</aside>
          </div>
        )}

        {layoutMode === "split" && (
          <div className="flex h-full min-h-0 flex-row">
            <aside className="flex w-[320px] shrink-0 border-r border-[var(--border)]">
              {queuePanel}
            </aside>
            <section className="flex min-h-0 min-w-0 flex-1 flex-col">
              <div className="shrink-0 border-b border-[var(--border)] px-3 py-2">
                <SegmentedControl
                  value={detailPanel}
                  onChange={(value) => setDetailPanel(value as DetailPanel)}
                  options={[
                    { value: "item", label: "Item" },
                    { value: "recommendation", label: "Recommendation" },
                  ]}
                />
              </div>
              <div className="min-h-0 flex-1">
                {detailPanel === "item" ? itemPanel : recommendationPanel}
              </div>
            </section>
          </div>
        )}

        {layoutMode === "stack" && (
          <div className="h-full min-h-0">
            {stackPanel === "queue" && queuePanel}
            {stackPanel === "item" && itemPanel}
            {stackPanel === "recommendation" && recommendationPanel}
          </div>
        )}
      </div>
    </div>
  );
}

function SegmentedControl({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="flex gap-1 overflow-x-auto pb-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={clsx(
            "whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium",
            value === option.value
              ? "bg-[color:var(--accent-muted)] text-[color:var(--accent)]"
              : "text-[color:var(--text-2)] hover:bg-[color:var(--bg-2)] hover:text-[color:var(--text-1)]",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function ItemDetailsFields({
  selectedItem,
  draftTitle,
  draftTags,
  setDraftTitle,
  setDraftTags,
}: {
  selectedItem: InboxItem;
  draftTitle: string;
  draftTags: string;
  setDraftTitle: (value: string) => void;
  setDraftTags: (value: string) => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-[color:var(--text-2)]">
          Title
        </label>
        <input
          value={draftTitle}
          onChange={(event) => setDraftTitle(event.target.value)}
          className="w-full rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-sm text-[color:var(--text-0)] outline-none"
        />
      </div>
      <div>
        <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-[color:var(--text-2)]">
          Tags
        </label>
        <input
          value={draftTags}
          onChange={(event) => setDraftTags(event.target.value)}
          placeholder="comma, separated, tags"
          className="w-full rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-sm text-[color:var(--text-0)] outline-none"
        />
      </div>
      {selectedItem.source_url && (
        <div className="rounded-lg border border-[var(--border)] bg-[color:var(--bg-0)] p-3">
          <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-[color:var(--text-2)]">
            Source URL
          </div>
          <div className="break-all text-xs text-[color:var(--text-1)]">
            {selectedItem.source_url}
          </div>
        </div>
      )}
      <div className="rounded-lg border border-[var(--border)] bg-[color:var(--bg-0)] p-3">
        <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-[color:var(--text-2)]">
          Item state
        </div>
        <div className="space-y-1 text-xs text-[color:var(--text-1)]">
          <div>Status: {selectedItem.status}</div>
          <div>Capture: {selectedItem.capture_state}</div>
          <div>Proposal: {selectedItem.proposal_state}</div>
          <div>Hash: {selectedItem.content_hash}</div>
        </div>
      </div>
    </div>
  );
}

function EditorCard({
  title,
  content,
  onChange,
  placeholder,
  bordered = false,
  chrome = true,
}: {
  title: string;
  content: string;
  onChange: (value: string) => void;
  placeholder: string;
  bordered?: boolean;
  chrome?: boolean;
}) {
  const containerClass = chrome
    ? clsx("flex h-full min-h-0 flex-col bg-[color:var(--bg-0)]", bordered && "border-t border-[var(--border)]")
    : "flex h-full min-h-0 flex-col";

  return (
    <div className={containerClass}>
      <div className="shrink-0 border-b border-[var(--border)] px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-[color:var(--text-2)]">
        {title}
      </div>
      <div className="min-h-0 flex-1 px-4 py-3">
        <div className="h-full rounded-xl border border-[var(--border)] bg-[color:var(--bg-1)] px-4 py-3">
          <HybridMarkdownEditor
            content={content}
            onChange={onChange}
            placeholder={placeholder}
            className="h-full"
            themeVariant="clean"
          />
        </div>
      </div>
    </div>
  );
}

interface InsightItem {
  key: string;
  title: string;
  meta: string;
  body: string;
}

function InsightCard({ title, items }: { title: string; items: InsightItem[] }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[color:var(--bg-0)] p-4">
      <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-[color:var(--text-2)]">
        {title}
      </div>
      <div className="space-y-3">
        {items.map((item) => (
          <div
            key={item.key}
            className="rounded-lg border border-[var(--border)] bg-[color:var(--bg-1)] p-3"
          >
            <div className="text-sm font-medium text-[color:var(--text-0)]">{item.title}</div>
            <div className="mt-1 text-[11px] font-mono text-[color:var(--text-2)]">
              {item.meta}
            </div>
            <div className="mt-2 text-xs leading-5 text-[color:var(--text-1)]">{item.body}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
