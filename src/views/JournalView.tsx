import { useEffect, useState, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Circle,
  CheckCircle2,
  Clock,
  XCircle,
  Loader2,
} from "lucide-react";
import { clsx } from "clsx";
import * as api from "../lib/tauri";
import { useAppStore } from "../lib/store";
import type {
  JournalBlock,
  JournalDateInfo,
  MemoryMeta,
  TaskState,
  TaskPriority,
} from "../lib/types";
import { MEMORY_ONTOLOGY_COLORS, MEMORY_ONTOLOGY_LABELS } from "../lib/types";

// ─── Helpers ───

function formatDateLabel(dateStr: string, t: (key: string) => string): string {
  const d = new Date(dateStr + "T12:00:00");
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);

  if (dateStr === todayStr) return t("journal.today");
  if (dateStr === yesterdayStr) return t("journal.yesterday");

  return d.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function formatDateShort(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function getDateRange(centerDate: string, count: number): string[] {
  const dates: string[] = [];
  const center = new Date(centerDate + "T12:00:00");
  for (let i = 0; i < count; i++) {
    const d = new Date(center);
    d.setDate(d.getDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

// ─── Task state icons ───

function TaskStateIcon({
  state,
  size = 14,
}: {
  state: TaskState;
  size?: number;
}) {
  switch (state) {
    case "todo":
      return <Circle className="text-[color:var(--warning)]" style={{ width: size, height: size }} />;
    case "in_progress":
      return <Clock className="text-[#3b82f6]" style={{ width: size, height: size }} />;
    case "done":
      return <CheckCircle2 className="text-[color:var(--success)]" style={{ width: size, height: size }} />;
    case "cancelled":
      return <XCircle className="text-[color:var(--text-2)]" style={{ width: size, height: size }} />;
  }
}

function PriorityBadge({ priority }: { priority: TaskPriority }) {
  const colors: Record<TaskPriority, string> = {
    a: "text-[color:var(--danger)]",
    b: "text-[color:var(--warning)]",
    c: "text-[color:var(--text-2)]",
  };
  return (
    <span className={clsx("font-mono text-[10px] font-semibold", colors[priority])}>
      #{priority.toUpperCase()}
    </span>
  );
}

// ─── Block component ───

interface BlockEditorProps {
  block: JournalBlock;
  onUpdate: (id: string, content: string) => void;
  onKeyDown: (id: string, e: React.KeyboardEvent) => void;
  onTaskToggle: (id: string) => void;
  inputRefs: React.MutableRefObject<Map<string, HTMLTextAreaElement>>;
}

function BlockEditor({
  block,
  onUpdate,
  onKeyDown,
  onTaskToggle,
  inputRefs,
}: BlockEditorProps) {
  const indent = block.indent * 24;

  return (
    <div className="group flex items-start gap-1" style={{ paddingLeft: indent }}>
      {/* Bullet or task icon */}
      <div className="mt-[5px] shrink-0">
        {block.task_state ? (
          <button
            type="button"
            onClick={() => onTaskToggle(block.id)}
            className="flex items-center justify-center"
          >
            <TaskStateIcon state={block.task_state} size={14} />
          </button>
        ) : (
          <span className="flex h-3.5 w-3.5 items-center justify-center">
            <span className="h-[5px] w-[5px] rounded-full bg-[color:var(--text-2)]" />
          </span>
        )}
      </div>

      {/* Priority badge */}
      {block.task_priority && (
        <div className="mt-[4px] shrink-0">
          <PriorityBadge priority={block.task_priority} />
        </div>
      )}

      {/* Content */}
      <textarea
        ref={(el) => {
          if (el) inputRefs.current.set(block.id, el);
        }}
        value={block.content}
        onChange={(e) => onUpdate(block.id, e.target.value)}
        onKeyDown={(e) => onKeyDown(block.id, e)}
        rows={1}
        className={clsx(
          "flex-1 resize-none bg-transparent py-0.5 text-[13px] leading-relaxed text-[color:var(--text-0)] placeholder:text-[color:var(--text-2)] focus:outline-none",
          block.task_state === "done" && "line-through text-[color:var(--text-2)]",
          block.task_state === "cancelled" && "line-through text-[color:var(--text-2)] opacity-50",
        )}
        placeholder="..."
        onInput={(e) => {
          const target = e.target as HTMLTextAreaElement;
          target.style.height = "auto";
          target.style.height = target.scrollHeight + "px";
        }}
      />
    </div>
  );
}

// ─── Day page component ───

interface DayPageProps {
  date: string;
  isToday: boolean;
}

function DayPage({ date, isToday }: DayPageProps) {
  const { t } = useTranslation();
  const memories = useAppStore((s) => s.memories);
  const [loaded, setLoaded] = useState(false);
  const [blocks, setBlocks] = useState<JournalBlock[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRefs = useRef<Map<string, HTMLTextAreaElement>>(new Map());
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const defaultBlock: JournalBlock = { id: "b-1", indent: 0, content: "", children: [], task_state: null, task_priority: null };

  useEffect(() => {
    setLoaded(false);
    setError(null);
    api.getJournalPage(date)
      .then((p) => {
        if (p.blocks.length === 0) {
          setBlocks([defaultBlock]);
        } else {
          setBlocks(p.blocks);
        }
        setLoaded(true);
      })
      .catch((e) => {
        console.error("Journal load error:", e);
        // Fallback: show empty editable page even if backend fails
        setBlocks([defaultBlock]);
        setLoaded(true);
        setError(String(e));
      });
  }, [date]);

  // Auto-save with debounce
  const scheduleAutoSave = useCallback(
    (updatedBlocks: JournalBlock[]) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        const md = blocksToMarkdown(updatedBlocks);
        setSaving(true);
        api.saveJournalPage(date, md).finally(() => {
          setSaving(false);
          setDirty(false);
        });
      }, 1500);
    },
    [date],
  );

  const updateBlock = useCallback(
    (id: string, content: string) => {
      setBlocks((prev) => {
        const next = prev.map((b) => (b.id === id ? { ...b, content } : b));
        setDirty(true);
        scheduleAutoSave(next);
        return next;
      });
    },
    [scheduleAutoSave],
  );

  const handleKeyDown = useCallback(
    (id: string, e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const idx = blocks.findIndex((b) => b.id === id);
        if (idx === -1) return;
        const currentIndent = blocks[idx].indent;
        const newId = `b-${Date.now()}`;
        const newBlock: JournalBlock = {
          id: newId,
          indent: currentIndent,
          content: "",
          children: [],
          task_state: null,
          task_priority: null,
        };
        const next = [...blocks];
        next.splice(idx + 1, 0, newBlock);
        setBlocks(next);
        setDirty(true);
        scheduleAutoSave(next);
        requestAnimationFrame(() => {
          const el = inputRefs.current.get(newId);
          el?.focus();
        });
      } else if (e.key === "Tab") {
        e.preventDefault();
        const idx = blocks.findIndex((b) => b.id === id);
        if (idx === -1) return;
        const delta = e.shiftKey ? -1 : 1;
        const newIndent = Math.max(0, Math.min(4, blocks[idx].indent + delta));
        const next = blocks.map((b) =>
          b.id === id ? { ...b, indent: newIndent } : b,
        );
        setBlocks(next);
        setDirty(true);
        scheduleAutoSave(next);
      } else if (
        e.key === "Backspace" &&
        blocks.find((b) => b.id === id)?.content === "" &&
        blocks.length > 1
      ) {
        e.preventDefault();
        const idx = blocks.findIndex((b) => b.id === id);
        if (idx === -1) return;
        const next = blocks.filter((b) => b.id !== id);
        setBlocks(next);
        setDirty(true);
        scheduleAutoSave(next);
        // Focus previous block
        const prevIdx = Math.max(0, idx - 1);
        if (next[prevIdx]) {
          requestAnimationFrame(() => {
            const el = inputRefs.current.get(next[prevIdx].id);
            el?.focus();
          });
        }
      }
    },
    [blocks, scheduleAutoSave],
  );

  const toggleTask = useCallback(
    (id: string) => {
      setBlocks((prev) => {
        const next = prev.map((b) => {
          if (b.id !== id) return b;
          if (!b.task_state) return b;
          const cycle: Record<string, string> = {
            todo: "in_progress",
            in_progress: "done",
            done: "todo",
            cancelled: "todo",
          };
          return { ...b, task_state: (cycle[b.task_state] ?? "todo") as TaskState };
        });
        setDirty(true);
        scheduleAutoSave(next);
        return next;
      });
    },
    [scheduleAutoSave],
  );

  if (!loaded) {
    return (
      <div className="mb-8">
        <div className="mb-3 flex items-center gap-3">
          <h2 className="text-lg font-semibold text-[color:var(--text-0)]">{formatDateLabel(date, t)}</h2>
          <Loader2 className="h-3.5 w-3.5 animate-spin text-[color:var(--text-2)]" />
        </div>
      </div>
    );
  }

  return (
    <div className="mb-8">
      {/* Date header */}
      <div className="mb-3 flex items-center gap-3">
        <h2
          className={clsx(
            "text-lg font-semibold",
            isToday ? "text-[color:var(--accent)]" : "text-[color:var(--text-0)]",
          )}
        >
          {formatDateLabel(date, t)}
        </h2>
        <span className="font-mono text-[11px] text-[color:var(--text-2)]">
          {date}
        </span>
        {saving && (
          <Loader2 className="h-3 w-3 animate-spin text-[color:var(--text-2)]" />
        )}
        {dirty && !saving && (
          <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--warning)]" />
        )}
        {error && (
          <span className="text-[10px] text-[color:var(--danger)]">{t("journal.backendError")}</span>
        )}
      </div>

      {/* Blocks */}
      <div className="space-y-0.5 rounded-lg border border-[var(--border)] bg-[color:var(--bg-0)] p-3">
        {blocks.map((block) => (
          <BlockEditor
            key={block.id}
            block={block}
            onUpdate={updateBlock}
            onKeyDown={handleKeyDown}
            onTaskToggle={toggleTask}
            inputRefs={inputRefs}
          />
        ))}
      </div>

      {/* Linked references */}
      <LinkedReferences date={date} memories={memories} />
    </div>
  );
}

// ─── Linked references ───

function LinkedReferences({ date, memories }: { date: string; memories: MemoryMeta[] }) {
  const { t } = useTranslation();
  const refs = memories.filter(
    (m) =>
      m.related.some((r) => r.includes(date)) ||
      m.tags.some((tag) => tag === date) ||
      m.l0.includes(date),
  );

  if (refs.length === 0) return null;

  return (
    <div className="mt-3">
      <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-[color:var(--text-2)]">
        {t("journal.linkedReferences", { count: refs.length })}
      </p>
      <div className="space-y-1">
        {refs.map((m) => (
          <div
            key={m.id}
            className="flex items-center gap-2 rounded border border-[var(--border)] bg-[color:var(--bg-0)] px-2.5 py-1.5"
          >
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: MEMORY_ONTOLOGY_COLORS[m.ontology] }}
            />
            <span className="text-[11px] font-medium text-[color:var(--text-1)]">{m.id}</span>
            <span className="flex-1 truncate text-[10px] text-[color:var(--text-2)]">{m.l0}</span>
            <span className="shrink-0 text-[10px] text-[color:var(--text-2)]">
              {MEMORY_ONTOLOGY_LABELS[m.ontology]}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main view ───

export function JournalView() {
  const [dates, setDates] = useState<string[]>([]);
  const [allDates, setAllDates] = useState<JournalDateInfo[]>([]);
  const [loadCount, setLoadCount] = useState(7);
  const [showPicker, setShowPicker] = useState(false);
  const [pickerDate, setPickerDate] = useState(todayStr());
  const scrollRef = useRef<HTMLDivElement>(null);
  const today = todayStr();

  // Initial load: today + past 6 days
  useEffect(() => {
    setDates(getDateRange(today, loadCount));
    api.listJournalDates().then(setAllDates).catch(console.error);
  }, [loadCount]);

  // Infinite scroll: load more when reaching bottom
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200) {
      setLoadCount((prev) => prev + 7);
    }
  }, []);

  const goToDate = useCallback(
    (date: string) => {
      setPickerDate(date);
      setShowPicker(false);
      // Generate range starting from selected date
      const range = getDateRange(date, 7);
      setDates(range);
      setLoadCount(7);
      scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    },
    [],
  );

  const goToToday = useCallback(() => {
    goToDate(todayStr());
  }, [goToDate]);

  const navigateDay = useCallback(
    (delta: number) => {
      const current = dates[0] || today;
      const d = new Date(current + "T12:00:00");
      d.setDate(d.getDate() + delta);
      goToDate(d.toISOString().slice(0, 10));
    },
    [dates, today, goToDate],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-[var(--border)] px-4 py-2">
        <button
          type="button"
          onClick={goToToday}
          className="rounded-md bg-[color:var(--accent-muted)] px-2.5 py-1 text-[11px] font-medium text-[color:var(--accent)] hover:bg-[color:var(--accent)]/20"
        >
          Today
        </button>

        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => navigateDay(1)}
            className="rounded p-1 text-[color:var(--text-2)] hover:bg-[color:var(--bg-2)]"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => navigateDay(-1)}
            className="rounded p-1 text-[color:var(--text-2)] hover:bg-[color:var(--bg-2)]"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>

        <span className="text-[11px] text-[color:var(--text-2)]">
          {formatDateShort(dates[0] || today)}
        </span>

        <div className="ml-auto flex items-center gap-2">
          {/* Date picker */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowPicker((prev) => !prev)}
              className="rounded p-1 text-[color:var(--text-2)] hover:bg-[color:var(--bg-2)]"
            >
              <Calendar className="h-3.5 w-3.5" />
            </button>
            {showPicker && (
              <div className="absolute right-0 top-8 z-50 rounded-lg border border-[var(--border)] bg-[color:var(--bg-2)] p-3 shadow-xl">
                <input
                  type="date"
                  value={pickerDate}
                  onChange={(e) => goToDate(e.target.value)}
                  className="rounded-md border border-[var(--border)] bg-[color:var(--bg-1)] px-2 py-1 text-xs text-[color:var(--text-0)]"
                />
                {allDates.length > 0 && (
                  <div className="mt-2 max-h-40 space-y-0.5 overflow-y-auto">
                    {allDates.slice(0, 20).map((d) => (
                      <button
                        key={d.date}
                        type="button"
                        onClick={() => goToDate(d.date)}
                        className="flex w-full items-center justify-between rounded px-2 py-1 text-left text-[11px] text-[color:var(--text-1)] hover:bg-[color:var(--bg-3)]"
                      >
                        <span>{d.date}</span>
                        <span className="font-mono text-[10px] text-[color:var(--text-2)]">
                          {d.block_count}b{d.has_tasks ? " ·T" : ""}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <span className="font-mono text-[10px] text-[color:var(--text-2)]">
            {allDates.length} days
          </span>
        </div>
      </div>

      {/* Scrollable day pages */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-6 py-4"
      >
        <div className="mx-auto max-w-2xl">
          {dates.map((date) => (
            <DayPage key={date} date={date} isToday={date === today} />
          ))}

          {/* Load more indicator */}
          <div className="flex items-center justify-center py-6">
            <button
              type="button"
              onClick={() => setLoadCount((prev) => prev + 7)}
              className="text-[11px] text-[color:var(--text-2)] hover:text-[color:var(--text-1)]"
            >
              Load more days...
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Markdown serialization ───

function blocksToMarkdown(blocks: JournalBlock[]): string {
  return blocks
    .map((b) => {
      const indent = "  ".repeat(b.indent);
      let line = `${indent}- `;
      if (b.task_state) {
        const stateMap: Record<string, string> = {
          todo: "TODO ",
          in_progress: "IN-PROGRESS ",
          done: "DONE ",
          cancelled: "CANCELLED ",
        };
        line += stateMap[b.task_state] ?? "";
      }
      if (b.task_priority) {
        line += `[#${b.task_priority.toUpperCase()}] `;
      }
      line += b.content;
      return line;
    })
    .join("\n");
}
