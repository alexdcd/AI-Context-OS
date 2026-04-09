import { useEffect, useState, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  Circle,
  CheckCircle2,
  Clock,
  XCircle,
  Plus,
  Calendar,
  Tag,
  Trash2,
  ChevronDown,
  ChevronRight,
  Save,
} from "lucide-react";
import { clsx } from "clsx";
import * as api from "../lib/tauri";
import type {
  TaskItem,
  TaskState,
  TaskPriority,
  TaskFilter,
} from "../lib/types";
import {
  TASK_STATE_LABELS,
  TASK_STATE_COLORS,
  TASK_PRIORITY_LABELS,
} from "../lib/types";

// ─── Helpers ───

function TaskStateIcon({ state, size = 16 }: { state: TaskState; size?: number }) {
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

function PriorityDot({ priority }: { priority: TaskPriority | null }) {
  const { t } = useTranslation();
  if (!priority) return null;
  const colors: Record<TaskPriority, string> = {
    a: "bg-[color:var(--danger)]",
    b: "bg-[color:var(--warning)]",
    c: "bg-[color:var(--text-2)]",
  };
  return (
    <span
      className={clsx("inline-block h-2 w-2 rounded-full", colors[priority])}
      title={t("tasks.priorityLabel") + " " + priority.toUpperCase()}
    />
  );
}

function relativeDate(dateStr: string, t: (key: string, opts?: object) => string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return t("tasks.today");
  if (days === 1) return t("tasks.tomorrow");
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ─── New task form ───

function NewTaskForm({ onCreated }: { onCreated: () => void }) {
  const { t } = useTranslation();
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<TaskPriority | "">("");
  const [creating, setCreating] = useState(false);

  const create = async () => {
    if (!title.trim()) return;
    setCreating(true);
    const id = await api.generateTaskId();
    const now = new Date().toISOString();
    await api.createTask({
      id,
      title: title.trim(),
      state: "todo",
      priority: priority || null,
      tags: [],
      source_date: null,
      source_file: null,
      created: now,
      modified: now,
      notes: "",
      due: null,
    });
    setTitle("");
    setPriority("");
    setCreating(false);
    onCreated();
  };

  return (
    <div className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[color:var(--bg-0)] px-3 py-2">
      <Plus className="h-3.5 w-3.5 shrink-0 text-[color:var(--text-2)]" />
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") create();
        }}
        placeholder={t("tasks.newPlaceholder")}
        className="flex-1 bg-transparent text-xs text-[color:var(--text-0)] placeholder:text-[color:var(--text-2)] focus:outline-none"
      />
      <select
        value={priority}
        onChange={(e) => setPriority(e.target.value as TaskPriority | "")}
        className="rounded border border-[var(--border)] bg-[color:var(--bg-2)] px-1.5 py-0.5 text-[10px] text-[color:var(--text-1)]"
      >
        <option value="">{t("tasks.noPriority")}</option>
        <option value="a">{t("tasks.priorityHigh")}</option>
        <option value="b">{t("tasks.priorityMedium")}</option>
        <option value="c">{t("tasks.priorityLow")}</option>
      </select>
      <button
        type="button"
        onClick={create}
        disabled={creating || !title.trim()}
        className="rounded-md bg-[color:var(--accent)] px-2.5 py-1 text-[10px] font-medium text-white disabled:opacity-40"
      >
        {t("tasks.create")}
      </button>
    </div>
  );
}

// ─── Task card (expandable with inline editing) ───

function TaskCard({
  task,
  onToggle,
  onDelete,
  onUpdate,
}: {
  task: TaskItem;
  onToggle: () => void;
  onDelete: () => void;
  onUpdate: (updated: TaskItem) => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [editTitle, setEditTitle] = useState(task.title);
  const [editPriority, setEditPriority] = useState<TaskPriority | "">(task.priority ?? "");
  const [editState, setEditState] = useState<TaskState>(task.state);
  const [editNotes, setEditNotes] = useState(task.notes);
  const [editDue, setEditDue] = useState(task.due ?? "");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const notesRef = useRef<HTMLTextAreaElement>(null);

  // Sync local state when task prop changes
  useEffect(() => {
    setEditTitle(task.title);
    setEditPriority(task.priority ?? "");
    setEditState(task.state);
    setEditNotes(task.notes);
    setEditDue(task.due ?? "");
    setDirty(false);
  }, [task]);

  const markDirty = () => setDirty(true);

  const save = async () => {
    setSaving(true);
    const updated: TaskItem = {
      ...task,
      title: editTitle.trim() || task.title,
      priority: editPriority || null,
      state: editState,
      notes: editNotes,
      due: editDue || null,
      modified: new Date().toISOString(),
    };
    await api.updateTask(updated);
    setSaving(false);
    setDirty(false);
    onUpdate(updated);
  };

  // Auto-resize notes textarea
  const autoResize = () => {
    const el = notesRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = el.scrollHeight + "px";
    }
  };

  // Focus notes when expanding
  useEffect(() => {
    if (expanded) {
      requestAnimationFrame(autoResize);
    }
  }, [expanded]);

  return (
    <div
      className={clsx(
        "rounded-lg border bg-[color:var(--bg-0)] transition-colors",
        expanded
          ? "border-[var(--border-active)]"
          : "border-[var(--border)] hover:border-[var(--border-active)]",
        task.state === "done" && !expanded && "opacity-60",
        task.state === "cancelled" && !expanded && "opacity-40",
      )}
    >
      {/* Collapsed row */}
      <div className="group flex items-start gap-2.5 px-3 py-2.5">
        <button type="button" onClick={onToggle} className="mt-0.5 shrink-0">
          <TaskStateIcon state={expanded ? editState : task.state} />
        </button>

        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className="mt-[3px] shrink-0 text-[color:var(--text-2)]"
        >
          {expanded ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <PriorityDot priority={expanded ? (editPriority || null) : task.priority} />
            {expanded ? (
              <input
                type="text"
                value={editTitle}
                onChange={(e) => {
                  setEditTitle(e.target.value);
                  markDirty();
                }}
                className="flex-1 bg-transparent text-[13px] font-medium text-[color:var(--text-0)] focus:outline-none"
              />
            ) : (
              <p
                className={clsx(
                  "cursor-pointer text-[13px] font-medium text-[color:var(--text-0)]",
                  (task.state === "done" || task.state === "cancelled") && "line-through",
                )}
                onClick={() => setExpanded(true)}
              >
                {task.title}
              </p>
            )}
          </div>

          {!expanded && (
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span
                className="rounded px-1.5 py-0.5 text-[10px] font-medium"
                style={{
                  color: TASK_STATE_COLORS[task.state],
                  backgroundColor: TASK_STATE_COLORS[task.state] + "15",
                }}
              >
                {TASK_STATE_LABELS[task.state]}
              </span>

              {task.priority && (
                <span className="font-mono text-[10px] text-[color:var(--text-2)]">
                  P:{task.priority.toUpperCase()}
                </span>
              )}

              {task.due && task.state !== "done" && task.state !== "cancelled" && (() => {
                const dueDate = new Date(task.due + "T23:59:59");
                const now = new Date();
                const diffDays = Math.ceil((dueDate.getTime() - now.getTime()) / 86400000);
                const color = diffDays < 0 ? "var(--danger)" : diffDays <= 1 ? "var(--warning)" : "var(--text-2)";
                const label = diffDays < 0
                  ? t("tasks.overdue", { n: -diffDays })
                  : diffDays === 0
                  ? t("tasks.today")
                  : diffDays === 1
                  ? t("tasks.tomorrow")
                  : task.due;
                return (
                  <span className="flex items-center gap-0.5 text-[10px] font-medium" style={{ color }}>
                    <Calendar className="h-2.5 w-2.5" />
                    {label}
                  </span>
                );
              })()}

              {task.source_date && (
                <span className="flex items-center gap-0.5 text-[10px] text-[color:var(--text-2)]">
                  <Calendar className="h-2.5 w-2.5" />
                  {task.source_date}
                </span>
              )}

              {task.tags.map((tag) => (
                <span
                  key={tag}
                  className="flex items-center gap-0.5 text-[10px] text-[color:var(--text-2)]"
                >
                  <Tag className="h-2.5 w-2.5" />
                  {tag}
                </span>
              ))}

              {task.notes && (
                <span className="truncate text-[10px] text-[color:var(--text-2)] opacity-70">
                  — {task.notes.slice(0, 60)}{task.notes.length > 60 ? "…" : ""}
                </span>
              )}

              <span className="ml-auto text-[10px] text-[color:var(--text-2)]">
                {relativeDate(task.modified, t)}
              </span>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={onDelete}
          className="shrink-0 rounded p-1 text-[color:var(--text-2)] opacity-0 transition-opacity group-hover:opacity-100 hover:text-[color:var(--danger)]"
          title={t("tasks.deleteTask")}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Expanded editor */}
      {expanded && (
        <div className="border-t border-[var(--border)] px-3 pb-3 pt-2.5">
          {/* Controls row */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5">
              <span className="text-[10px] text-[color:var(--text-2)]">{t("tasks.statusLabel")}</span>
              <select
                value={editState}
                onChange={(e) => {
                  setEditState(e.target.value as TaskState);
                  markDirty();
                }}
                className="rounded border border-[var(--border)] bg-[color:var(--bg-2)] px-1.5 py-0.5 text-[11px] text-[color:var(--text-1)]"
              >
                {(["todo", "in_progress", "done", "cancelled"] as TaskState[]).map((s) => (
                  <option key={s} value={s}>{TASK_STATE_LABELS[s]}</option>
                ))}
              </select>
            </label>

            <label className="flex items-center gap-1.5">
              <span className="text-[10px] text-[color:var(--text-2)]">{t("tasks.priorityLabel")}</span>
              <select
                value={editPriority}
                onChange={(e) => {
                  setEditPriority(e.target.value as TaskPriority | "");
                  markDirty();
                }}
                className="rounded border border-[var(--border)] bg-[color:var(--bg-2)] px-1.5 py-0.5 text-[11px] text-[color:var(--text-1)]"
              >
                <option value="">—</option>
                <option value="a">{t("tasks.priorityHigh")}</option>
                <option value="b">{t("tasks.priorityMedium")}</option>
                <option value="c">{t("tasks.priorityLow")}</option>
              </select>
            </label>

            <label className="flex items-center gap-1.5">
              <span className="text-[10px] text-[color:var(--text-2)]">{t("tasks.dueLabel")}</span>
              <input
                type="date"
                value={editDue}
                onChange={(e) => {
                  setEditDue(e.target.value);
                  markDirty();
                }}
                className="rounded border border-[var(--border)] bg-[color:var(--bg-2)] px-1.5 py-0.5 text-[11px] text-[color:var(--text-1)]"
              />
            </label>

            {task.source_date && (
              <span className="flex items-center gap-0.5 text-[10px] text-[color:var(--text-2)]">
                <Calendar className="h-2.5 w-2.5" />
                {task.source_date}
              </span>
            )}

            <span className="ml-auto text-[10px] text-[color:var(--text-2)]">
              {relativeDate(task.modified, t)}
            </span>
          </div>

          {/* Notes editor */}
          <div className="space-y-1.5">
            <span className="text-[10px] text-[color:var(--text-2)]">{t("tasks.notesLabel")}</span>
            <textarea
              ref={notesRef}
              value={editNotes}
              onChange={(e) => {
                setEditNotes(e.target.value);
                markDirty();
                autoResize();
              }}
              onInput={autoResize}
              rows={3}
              placeholder={t("tasks.notesPlaceholder")}
              className="w-full resize-none rounded-md border border-[var(--border)] bg-[color:var(--bg-2)] px-2.5 py-2 font-mono text-[12px] leading-relaxed text-[color:var(--text-0)] placeholder:text-[color:var(--text-2)] focus:border-[var(--border-active)] focus:outline-none"
            />
            <p className="text-[10px] text-[color:var(--text-2)] opacity-60">
              {t("tasks.notesHint")}
            </p>
          </div>

          {/* Save button */}
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={save}
              disabled={!dirty || saving}
              className={clsx(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-medium transition-colors",
                dirty
                  ? "bg-[color:var(--accent)] text-white hover:opacity-90"
                  : "bg-[color:var(--bg-3)] text-[color:var(--text-2)]",
              )}
            >
              <Save className="h-3 w-3" />
              {saving ? t("tasks.saving") : t("tasks.save")}
            </button>
            {dirty && (
              <span className="text-[10px] text-[color:var(--warning)]">{t("tasks.unsaved")}</span>
            )}
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="ml-auto text-[11px] text-[color:var(--text-2)] hover:text-[color:var(--text-1)]"
            >
              {t("tasks.close")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main view ───

export function TaskView() {
  const { t } = useTranslation();
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [stateFilter, setStateFilter] = useState<TaskState | "all">("all");
  const [priorityFilter, setPriorityFilter] = useState<TaskPriority | "all">("all");
  const [loading, setLoading] = useState(true);

  const loadTasks = useCallback(async () => {
    setLoading(true);
    const filter: TaskFilter = {};
    if (stateFilter !== "all") filter.state = stateFilter;
    if (priorityFilter !== "all") filter.priority = priorityFilter;
    const items = await api.listTasks(Object.keys(filter).length > 0 ? filter : undefined);
    setTasks(items);
    setLoading(false);
  }, [stateFilter, priorityFilter]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  const handleToggle = async (id: string) => {
    await api.toggleTaskState(id);
    loadTasks();
  };

  const handleDelete = async (id: string) => {
    await api.deleteTask(id);
    loadTasks();
  };

  const handleUpdate = (updated: TaskItem) => {
    setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
  };

  // Stats
  const stats = {
    total: tasks.length,
    todo: tasks.filter((t) => t.state === "todo").length,
    inProgress: tasks.filter((t) => t.state === "in_progress").length,
    done: tasks.filter((t) => t.state === "done").length,
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-2">
        {/* Quick stats */}
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1 text-[11px] text-[color:var(--text-2)]">
            <Circle className="h-2.5 w-2.5 text-[color:var(--warning)]" />
            {stats.todo}
          </span>
          <span className="flex items-center gap-1 text-[11px] text-[color:var(--text-2)]">
            <Clock className="h-2.5 w-2.5 text-[#3b82f6]" />
            {stats.inProgress}
          </span>
          <span className="flex items-center gap-1 text-[11px] text-[color:var(--text-2)]">
            <CheckCircle2 className="h-2.5 w-2.5 text-[color:var(--success)]" />
            {stats.done}
          </span>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          {/* State filter */}
          <select
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value as TaskState | "all")}
            className="rounded border border-[var(--border)] bg-[color:var(--bg-2)] px-2 py-1 text-[11px] text-[color:var(--text-1)]"
          >
            <option value="all">{t("tasks.filterAllStatuses")}</option>
            {(["todo", "in_progress", "done", "cancelled"] as TaskState[]).map((s) => (
              <option key={s} value={s}>{TASK_STATE_LABELS[s]}</option>
            ))}
          </select>

          {/* Priority filter */}
          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value as TaskPriority | "all")}
            className="rounded border border-[var(--border)] bg-[color:var(--bg-2)] px-2 py-1 text-[11px] text-[color:var(--text-1)]"
          >
            <option value="all">{t("tasks.filterAllPriorities")}</option>
            {(["a", "b", "c"] as TaskPriority[]).map((p) => (
              <option key={p} value={p}>{TASK_PRIORITY_LABELS[p]}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto max-w-2xl space-y-3">
          {/* New task form */}
          <NewTaskForm onCreated={loadTasks} />

          {/* Task list */}
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              onToggle={() => handleToggle(task.id)}
              onDelete={() => handleDelete(task.id)}
              onUpdate={handleUpdate}
            />
          ))}

          {!loading && tasks.length === 0 && (
            <div className="py-16 text-center">
              <CheckCircle2 className="mx-auto mb-3 h-8 w-8 text-[color:var(--text-2)]" />
              <p className="text-xs text-[color:var(--text-2)]">
                {stateFilter === "all" && priorityFilter === "all"
                  ? t("tasks.emptyAll")
                  : t("tasks.emptyFilter")}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
