import { useCallback, useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import {
  Check,
  ChevronRight,
  FileInput,
  FileText,
  Globe,
  Inbox,
  Link as LinkIcon,
  Loader2,
  RefreshCw,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { clsx } from "clsx";
import { useTranslation } from "react-i18next";
import * as api from "../lib/tauri";
import type {
  IngestProposal,
  InboxItem,
  InboxItemKind,
  InboxItemStatus,
} from "../lib/types";
import { useAppStore } from "../lib/store";

const STATUS_COLORS: Record<InboxItemStatus, string> = {
  new: "bg-[color:var(--bg-2)] text-[color:var(--text-1)]",
  normalized: "bg-sky-500/10 text-sky-500",
  proposal_ready: "bg-amber-500/10 text-amber-500",
  processed: "bg-emerald-500/10 text-emerald-500",
  promoted: "bg-[color:var(--accent-muted)] text-[color:var(--accent)]",
  discarded: "bg-rose-500/10 text-rose-500",
  error: "bg-red-500/10 text-red-500",
};

const KIND_ICONS: Record<InboxItemKind, typeof FileText> = {
  text: FileText,
  link: Globe,
  file: FileInput,
};

export function InboxView() {
  const { t } = useTranslation();
  const [items, setItems] = useState<InboxItem[]>([]);
  const [proposals, setProposals] = useState<IngestProposal[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filterKind, setFilterKind] = useState<InboxItemKind | "all">("all");
  const [filterState, setFilterState] = useState<InboxItemStatus | "all">("all");
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [showTextComposer, setShowTextComposer] = useState(false);
  const [showLinkComposer, setShowLinkComposer] = useState(false);
  const [textTitle, setTextTitle] = useState("");
  const [textBody, setTextBody] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkNotes, setLinkNotes] = useState("");
  const [linkTitle, setLinkTitle] = useState("");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftL1, setDraftL1] = useState("");
  const [draftL2, setDraftL2] = useState("");
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [providerMessage, setProviderMessage] = useState<string>("");
  const loadMemories = useAppStore((s) => s.loadMemories);
  const loadGraph = useAppStore((s) => s.loadGraph);
  const loadFileTree = useAppStore((s) => s.loadFileTree);

  const refresh = async () => {
    setLoading(true);
    try {
      const [nextItems, nextProposals, providerStatus] = await Promise.all([
        api.listInboxItems(),
        api.listIngestProposals(),
        api.getInferenceProviderStatus(),
      ]);
      setItems(nextItems);
      setProposals(nextProposals);
      setProviderMessage(providerStatus.message);
      setSelectedId((current) => current ?? nextItems[0]?.id ?? null);
      if (!selectedId && nextItems[0]) {
        setDraftTitle(nextItems[0].title);
        setDraftL1(nextItems[0].l1_content);
        setDraftL2(nextItems[0].l2_content);
      }
    } catch (error) {
      setStatusMessage(String(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (filterKind !== "all" && item.kind !== filterKind) return false;
      if (filterState !== "all" && item.status !== filterState) return false;
      return true;
    });
  }, [items, filterKind, filterState]);

  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedId) ?? filteredItems[0] ?? null,
    [items, filteredItems, selectedId],
  );

  const itemProposal = useMemo(() => {
    if (!selectedItem) return null;
    return proposals.find(
      (proposal) => proposal.item_id === selectedItem.id && proposal.state === "pending",
    ) ?? null;
  }, [proposals, selectedItem]);

  useEffect(() => {
    if (selectedItem) {
      setDraftTitle(selectedItem.title);
      setDraftL1(selectedItem.l1_content);
      setDraftL2(selectedItem.l2_content);
    }
  }, [selectedItem?.id]);

  const counts = useMemo(() => {
    return {
      total: items.length,
      pending: items.filter((item) => item.status === "proposal_ready").length,
      promoted: items.filter((item) => item.status === "promoted").length,
    };
  }, [items]);

  const withBusy = async (key: string, action: () => Promise<void>) => {
    setBusyAction(key);
    setStatusMessage("");
    try {
      await action();
    } catch (error) {
      setStatusMessage(String(error));
    } finally {
      setBusyAction(null);
    }
  };

  const handleCreateText = async () => {
    await withBusy("create-text", async () => {
      const created = await api.createInboxText({
        title: textTitle || t("inbox.defaultTextTitle"),
        content: textBody,
      });
      setShowTextComposer(false);
      setTextTitle("");
      setTextBody("");
      await refresh();
      setSelectedId(created.id);
      await loadFileTree();
    });
  };

  const handleCreateLink = async () => {
    await withBusy("create-link", async () => {
      const created = await api.createInboxLink({
        url: linkUrl,
        title: linkTitle || null,
        notes: linkNotes || null,
      });
      setShowLinkComposer(false);
      setLinkUrl("");
      setLinkTitle("");
      setLinkNotes("");
      await refresh();
      setSelectedId(created.id);
      await loadFileTree();
    });
  };

  const handleImport = async () => {
    const result = await open({ multiple: true, directory: false });
    const paths = Array.isArray(result) ? result : result ? [result] : [];
    if (paths.length === 0) return;
    await withBusy("import", async () => {
      await api.importInboxFiles(paths);
      await refresh();
      await loadFileTree();
    });
  };

  // Tauri v2 native drag-drop: listen for file drop events from the OS
  const handleNativeDrop = useCallback(
    async (paths: string[]) => {
      if (paths.length === 0) return;
      await withBusy("drop", async () => {
        await api.importInboxFiles(paths);
        await refresh();
        await loadFileTree();
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loadFileTree],
  );

  useEffect(() => {
    const unlisten = getCurrentWindow().onDragDropEvent((event) => {
      if (event.payload.type === "drop") {
        void handleNativeDrop(event.payload.paths);
      }
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [handleNativeDrop]);

  useEffect(() => {
    const unlisten = listen<string>("inference-error", (event) => {
      setStatusMessage(`Inference error: ${event.payload}`);
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  const handleSaveSelected = async () => {
    if (!selectedItem) return;
    await withBusy(`save-${selectedItem.id}`, async () => {
      await api.updateInboxItem({
        id: selectedItem.id,
        title: draftTitle,
        l1_content: draftL1,
        l2_content: draftL2,
      });
      await refresh();
    });
  };

  const handleNormalize = async () => {
    if (!selectedItem) return;
    await withBusy(`normalize-${selectedItem.id}`, async () => {
      await api.normalizeInboxItem(selectedItem.id);
      await refresh();
    });
  };

  const handleGenerateProposal = async () => {
    if (!selectedItem) return;
    await withBusy(`proposal-${selectedItem.id}`, async () => {
      await api.generateIngestProposals([selectedItem.id]);
      await refresh();
    });
  };

  const handleApproveProposal = async () => {
    if (!itemProposal) return;
    await withBusy(`approve-${itemProposal.id}`, async () => {
      await api.applyIngestProposal({ proposal_id: itemProposal.id });
      await refresh();
      await Promise.all([loadMemories(), loadGraph(), loadFileTree()]);
    });
  };

  const handleRejectProposal = async () => {
    if (!itemProposal) return;
    await withBusy(`reject-${itemProposal.id}`, async () => {
      await api.rejectIngestProposal(itemProposal.id);
      await refresh();
    });
  };

  const handleDiscardItem = async () => {
    if (!selectedItem) return;
    await withBusy(`discard-${selectedItem.id}`, async () => {
      await api.updateInboxItem({ id: selectedItem.id, status: "discarded" });
      await refresh();
    });
  };

  return (
    <div className="flex h-full min-h-0 bg-[color:var(--bg-1)]">
      <aside className="flex w-[340px] shrink-0 flex-col border-r border-[color:var(--border)] bg-[color:var(--bg-0)]">
        <div className="border-b border-[color:var(--border)] px-4 py-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-lg font-semibold text-[color:var(--text-0)]">{t("sidebar.inbox")}</h1>
              <p className="mt-1 text-xs text-[color:var(--text-2)]">{t("inbox.subtitle")}</p>
            </div>
            <button
              type="button"
              onClick={() => void refresh()}
              className="rounded-md border border-[color:var(--border)] p-2 text-[color:var(--text-2)] transition-colors hover:bg-[color:var(--bg-2)] hover:text-[color:var(--text-0)]"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
            <StatCard label={t("inbox.stats.total")} value={counts.total} />
            <StatCard label={t("inbox.stats.pending")} value={counts.pending} />
            <StatCard label={t("inbox.stats.promoted")} value={counts.promoted} />
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <ActionButton icon={FileText} label={t("inbox.actions.newText")} onClick={() => setShowTextComposer((value) => !value)} />
            <ActionButton icon={LinkIcon} label={t("inbox.actions.newLink")} onClick={() => setShowLinkComposer((value) => !value)} />
            <ActionButton icon={Upload} label={t("inbox.actions.importFiles")} onClick={() => void handleImport()} />
          </div>

          {showTextComposer && (
            <div className="mt-4 rounded-xl border border-[color:var(--border)] bg-[color:var(--bg-1)] p-3">
              <input
                value={textTitle}
                onChange={(event) => setTextTitle(event.target.value)}
                placeholder={t("inbox.compose.textTitle")}
                className="mb-2 w-full rounded-md border border-[color:var(--border)] bg-[color:var(--bg-0)] px-3 py-2 text-sm text-[color:var(--text-0)] outline-none"
              />
              <textarea
                value={textBody}
                onChange={(event) => setTextBody(event.target.value)}
                placeholder={t("inbox.compose.textBody")}
                className="min-h-[96px] w-full rounded-md border border-[color:var(--border)] bg-[color:var(--bg-0)] px-3 py-2 text-sm text-[color:var(--text-0)] outline-none"
              />
              <div className="mt-3 flex justify-end gap-2">
                <SecondaryButton label={t("inbox.actions.cancel")} onClick={() => setShowTextComposer(false)} />
                <PrimaryButton
                  label={t("inbox.actions.capture")}
                  onClick={() => void handleCreateText()}
                  busy={busyAction === "create-text"}
                />
              </div>
            </div>
          )}

          {showLinkComposer && (
            <div className="mt-4 rounded-xl border border-[color:var(--border)] bg-[color:var(--bg-1)] p-3">
              <input
                value={linkUrl}
                onChange={(event) => setLinkUrl(event.target.value)}
                placeholder="https://"
                className="mb-2 w-full rounded-md border border-[color:var(--border)] bg-[color:var(--bg-0)] px-3 py-2 text-sm text-[color:var(--text-0)] outline-none"
              />
              <input
                value={linkTitle}
                onChange={(event) => setLinkTitle(event.target.value)}
                placeholder={t("inbox.compose.linkTitle")}
                className="mb-2 w-full rounded-md border border-[color:var(--border)] bg-[color:var(--bg-0)] px-3 py-2 text-sm text-[color:var(--text-0)] outline-none"
              />
              <textarea
                value={linkNotes}
                onChange={(event) => setLinkNotes(event.target.value)}
                placeholder={t("inbox.compose.linkNotes")}
                className="min-h-[80px] w-full rounded-md border border-[color:var(--border)] bg-[color:var(--bg-0)] px-3 py-2 text-sm text-[color:var(--text-0)] outline-none"
              />
              <div className="mt-3 flex justify-end gap-2">
                <SecondaryButton label={t("inbox.actions.cancel")} onClick={() => setShowLinkComposer(false)} />
                <PrimaryButton
                  label={t("inbox.actions.capture")}
                  onClick={() => void handleCreateLink()}
                  busy={busyAction === "create-link"}
                />
              </div>
            </div>
          )}

          <div
            className="mt-4 rounded-xl border border-dashed border-[color:var(--border-active)] bg-[color:var(--accent-muted)]/30 px-4 py-4 text-center"
          >
            <Inbox className="mx-auto h-5 w-5 text-[color:var(--accent)]" />
            <p className="mt-2 text-sm text-[color:var(--text-1)]">{t("inbox.dropTitle")}</p>
            <p className="mt-1 text-xs text-[color:var(--text-2)]">{t("inbox.dropDesc")}</p>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <select
              value={filterKind}
              onChange={(event) => setFilterKind(event.target.value as InboxItemKind | "all")}
              className="rounded-md border border-[color:var(--border)] bg-[color:var(--bg-1)] px-3 py-2 text-xs text-[color:var(--text-1)]"
            >
              <option value="all">{t("inbox.filters.allKinds")}</option>
              <option value="text">{t("inbox.kinds.text")}</option>
              <option value="link">{t("inbox.kinds.link")}</option>
              <option value="file">{t("inbox.kinds.file")}</option>
            </select>
            <select
              value={filterState}
              onChange={(event) => setFilterState(event.target.value as InboxItemStatus | "all")}
              className="rounded-md border border-[color:var(--border)] bg-[color:var(--bg-1)] px-3 py-2 text-xs text-[color:var(--text-1)]"
            >
              <option value="all">{t("inbox.filters.allStates")}</option>
              {(["new", "normalized", "proposal_ready", "processed", "promoted", "discarded", "error"] as InboxItemStatus[]).map((status) => (
                <option key={status} value={status}>{t(`inbox.states.${status}`)}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {loading ? (
            <div className="flex h-full items-center justify-center text-[color:var(--text-2)]">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="px-3 py-6 text-sm text-[color:var(--text-2)]">{t("inbox.empty")}</div>
          ) : (
            filteredItems.map((item) => {
              const Icon = KIND_ICONS[item.kind];
              const active = selectedItem?.id === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedId(item.id)}
                  className={clsx(
                    "mb-2 w-full rounded-xl border px-3 py-3 text-left transition-colors",
                    active
                      ? "border-[color:var(--accent)] bg-[color:var(--accent-muted)]/50"
                      : "border-[color:var(--border)] bg-[color:var(--bg-1)] hover:border-[color:var(--border-active)]",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <div className="mt-0.5 rounded-lg bg-[color:var(--bg-2)] p-2 text-[color:var(--text-1)]">
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-[color:var(--text-0)]">{item.title}</div>
                        <div className="mt-1 line-clamp-2 text-xs text-[color:var(--text-2)]">{item.summary || t("inbox.noPreview")}</div>
                      </div>
                    </div>
                    <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-[color:var(--text-2)]" />
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <span className={clsx("rounded-full px-2 py-1 text-[10px] font-medium uppercase tracking-wide", STATUS_COLORS[item.status])}>
                      {t(`inbox.states.${item.status}`)}
                    </span>
                    <span className="text-[10px] text-[color:var(--text-2)]">{new Date(item.modified).toLocaleString()}</span>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </aside>

      <section className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-4xl space-y-5">
          <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--bg-0)] p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-[color:var(--text-0)]">{t("inbox.ai.title")}</h2>
                <p className="mt-1 text-sm text-[color:var(--text-2)]">{providerMessage}</p>
              </div>
              <div className="rounded-full bg-[color:var(--bg-2)] px-3 py-1 text-xs text-[color:var(--text-1)]">
                {t("inbox.ai.hint")}
              </div>
            </div>
          </div>

          {statusMessage && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-600">
              {statusMessage}
            </div>
          )}

          {!selectedItem ? (
            <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--bg-0)] p-8 text-center text-[color:var(--text-2)]">
              {t("inbox.emptySelection")}
            </div>
          ) : (
            <>
              <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--bg-0)] p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={clsx("rounded-full px-2 py-1 text-[10px] font-medium uppercase tracking-wide", STATUS_COLORS[selectedItem.status])}>
                        {t(`inbox.states.${selectedItem.status}`)}
                      </span>
                      <span className="rounded-full bg-[color:var(--bg-2)] px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-[color:var(--text-1)]">
                        {t(`inbox.kinds.${selectedItem.kind}`)}
                      </span>
                    </div>
                    <h2 className="mt-3 text-xl font-semibold text-[color:var(--text-0)]">{selectedItem.title}</h2>
                    <p className="mt-2 max-w-2xl text-sm text-[color:var(--text-2)]">{selectedItem.summary}</p>
                    <div className="mt-3 flex flex-wrap gap-3 text-xs text-[color:var(--text-2)]">
                      <span>{selectedItem.content_hash}</span>
                      {selectedItem.source_url && (
                        <a href={selectedItem.source_url} target="_blank" rel="noreferrer" className="text-[color:var(--accent)] underline-offset-2 hover:underline">
                          {selectedItem.source_url}
                        </a>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <SecondaryButton
                      label={t("inbox.actions.normalize")}
                      onClick={() => void handleNormalize()}
                      icon={RefreshCw}
                    />
                    <SecondaryButton
                      label={busyAction === `proposal-${selectedItem.id}` ? t("inbox.ai.inferring") : t("inbox.actions.generateProposal")}
                      onClick={() => void handleGenerateProposal()}
                      busy={busyAction === `proposal-${selectedItem.id}`}
                      icon={Sparkles}
                    />
                    <SecondaryButton
                      label={t("inbox.actions.discard")}
                      onClick={() => void handleDiscardItem()}
                      icon={X}
                    />
                  </div>
                </div>
              </div>

              <div className="grid gap-5 lg:grid-cols-[1.4fr_0.9fr]">
                <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--bg-0)] p-5">
                  <div className="mb-4 flex items-center justify-between">
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-[color:var(--text-2)]">{t("inbox.editor.title")}</h3>
                    <PrimaryButton
                      label={t("inbox.actions.save")}
                      onClick={() => void handleSaveSelected()}
                      busy={busyAction === `save-${selectedItem.id}`}
                    />
                  </div>
                  <div className="space-y-3">
                    <input
                      value={draftTitle}
                      onChange={(event) => setDraftTitle(event.target.value)}
                      className="w-full rounded-xl border border-[color:var(--border)] bg-[color:var(--bg-1)] px-3 py-2 text-sm text-[color:var(--text-0)] outline-none"
                    />
                    <textarea
                      value={draftL1}
                      onChange={(event) => setDraftL1(event.target.value)}
                      placeholder={t("inbox.editor.l1")}
                      className="min-h-[150px] w-full rounded-xl border border-[color:var(--border)] bg-[color:var(--bg-1)] px-3 py-3 text-sm text-[color:var(--text-0)] outline-none"
                    />
                    <textarea
                      value={draftL2}
                      onChange={(event) => setDraftL2(event.target.value)}
                      placeholder={t("inbox.editor.l2")}
                      className="min-h-[220px] w-full rounded-xl border border-[color:var(--border)] bg-[color:var(--bg-1)] px-3 py-3 text-sm text-[color:var(--text-0)] outline-none"
                    />
                  </div>
                </div>

                <div className="space-y-5">
                  <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--bg-0)] p-5">
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-[color:var(--text-2)]">{t("inbox.metadata.title")}</h3>
                    <dl className="mt-4 space-y-3 text-sm">
                      <MetaRow label={t("inbox.metadata.created")} value={new Date(selectedItem.created).toLocaleString()} />
                      <MetaRow label={t("inbox.metadata.modified")} value={new Date(selectedItem.modified).toLocaleString()} />
                      <MetaRow label={t("inbox.metadata.captureState")} value={selectedItem.capture_state} />
                      <MetaRow label={t("inbox.metadata.proposalState")} value={selectedItem.proposal_state} />
                      <MetaRow label={t("inbox.metadata.extraction")} value={selectedItem.needs_extraction ? t("inbox.yes") : t("inbox.no")} />
                      <MetaRow label={t("inbox.metadata.inference")} value={selectedItem.needs_inference ? t("inbox.yes") : t("inbox.no")} />
                    </dl>
                    {selectedItem.attachments.length > 0 && (
                      <div className="mt-4 border-t border-[color:var(--border)] pt-4">
                        <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--text-2)]">{t("inbox.metadata.attachments")}</div>
                        <div className="mt-2 space-y-2">
                          {selectedItem.attachments.map((attachment) => (
                            <div key={attachment.path} className="rounded-xl bg-[color:var(--bg-1)] px-3 py-2 text-xs text-[color:var(--text-1)]">
                              <div className="font-medium text-[color:var(--text-0)]">{attachment.original_name}</div>
                              <div className="mt-1 break-all text-[color:var(--text-2)]">{attachment.path}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--bg-0)] p-5">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-sm font-semibold uppercase tracking-wide text-[color:var(--text-2)]">{t("inbox.proposal.title")}</h3>
                      {itemProposal ? (
                        <span className="rounded-full bg-amber-500/10 px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-amber-500">
                          {t("inbox.proposal.pending")}
                        </span>
                      ) : null}
                    </div>
                    {itemProposal ? (
                      <div className="mt-4 space-y-4">
                        <div>
                          <div className="text-sm font-medium text-[color:var(--text-0)]">{itemProposal.action}</div>
                          <p className="mt-2 text-sm text-[color:var(--text-2)]">{itemProposal.rationale}</p>
                        </div>
                        <div className="grid grid-cols-2 gap-3 text-xs text-[color:var(--text-2)]">
                          <div className="rounded-xl bg-[color:var(--bg-1)] px-3 py-2">
                            <div className="font-medium text-[color:var(--text-0)]">{t("inbox.proposal.confidence")}</div>
                            <div className="mt-1">{Math.round(itemProposal.confidence * 100)}%</div>
                          </div>
                          <div className="rounded-xl bg-[color:var(--bg-1)] px-3 py-2">
                            <div className="font-medium text-[color:var(--text-0)]">{t("inbox.proposal.origin")}</div>
                            <div className="mt-1">{itemProposal.origin}</div>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <PrimaryButton
                            label={t("inbox.actions.approveProposal")}
                            onClick={() => void handleApproveProposal()}
                            busy={busyAction === `approve-${itemProposal.id}`}
                            icon={Check}
                          />
                          <SecondaryButton
                            label={t("inbox.actions.rejectProposal")}
                            onClick={() => void handleRejectProposal()}
                            icon={X}
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="mt-4 rounded-xl bg-[color:var(--bg-1)] px-4 py-4 text-sm text-[color:var(--text-2)]">
                        {t("inbox.proposal.empty")}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--bg-1)] px-3 py-3">
      <div className="text-[10px] font-medium uppercase tracking-wide text-[color:var(--text-2)]">{label}</div>
      <div className="mt-1 text-lg font-semibold text-[color:var(--text-0)]">{value}</div>
    </div>
  );
}

function ActionButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof FileText;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-xl border border-[color:var(--border)] bg-[color:var(--bg-1)] px-3 py-2 text-xs font-medium text-[color:var(--text-1)] transition-colors hover:border-[color:var(--border-active)] hover:text-[color:var(--text-0)]"
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

function PrimaryButton({
  label,
  onClick,
  busy = false,
  icon: Icon,
}: {
  label: string;
  onClick: () => void;
  busy?: boolean;
  icon?: typeof Check;
}) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-xl bg-[color:var(--accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : Icon ? <Icon className="h-4 w-4" /> : null}
      {label}
    </button>
  );
}

function SecondaryButton({
  label,
  onClick,
  busy = false,
  icon: Icon,
}: {
  label: string;
  onClick: () => void;
  busy?: boolean;
  icon?: typeof Check;
}) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-xl border border-[color:var(--border)] bg-[color:var(--bg-1)] px-3 py-2 text-sm font-medium text-[color:var(--text-1)] transition-colors hover:border-[color:var(--border-active)] hover:text-[color:var(--text-0)] disabled:opacity-60"
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : Icon ? <Icon className="h-4 w-4" /> : null}
      {label}
    </button>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-[color:var(--border)] pb-3 last:border-b-0 last:pb-0">
      <dt className="text-[color:var(--text-2)]">{label}</dt>
      <dd className="text-right text-[color:var(--text-0)]">{value}</dd>
    </div>
  );
}
