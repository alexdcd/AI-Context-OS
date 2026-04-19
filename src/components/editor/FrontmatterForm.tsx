import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, FileSymlink } from "lucide-react";
import type { BacklinkRef, MemoryMeta, MemoryOntology } from "../../lib/types";
import { getBacklinks } from "../../lib/tauri";
import { useAppStore } from "../../lib/store";

interface FrontmatterFormProps {
  meta: MemoryMeta;
  onChange: (meta: MemoryMeta) => void;
  readonly?: boolean;
}

interface ChipEditorProps {
  label: string;
  values: string[];
  placeholder: string;
  disabled?: boolean;
  onAdd: (value: string) => void;
  onRemove: (value: string) => void;
}

function ChipEditor({
  label,
  values,
  placeholder,
  disabled = false,
  onAdd,
  onRemove,
}: ChipEditorProps) {
  const [input, setInput] = useState("");

  const commit = () => {
    if (disabled) return;
    const value = input.trim();
    if (!value) return;
    onAdd(value);
    setInput("");
  };

  return (
    <div className="space-y-1">
      <span className="text-[10px] text-[color:var(--text-2)]">{label}</span>
      <div className="flex flex-wrap items-center gap-1 rounded-md border border-[var(--border)] bg-[color:var(--bg-2)] px-2 py-1.5">
        {values.map((value) => (
          <span
            key={value}
            className="inline-flex items-center gap-0.5 rounded bg-[color:var(--bg-3)] px-1.5 py-0.5 text-[11px] text-[color:var(--text-1)]"
          >
            {value}
            <button
              type="button"
              disabled={disabled}
              onClick={() => onRemove(value)}
              className="text-[color:var(--text-2)] hover:text-[color:var(--text-0)]"
            >
              ×
            </button>
          </span>
        ))}
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={disabled}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              commit();
            }
          }}
          placeholder={values.length === 0 ? placeholder : ""}
          className="min-w-[80px] flex-1 bg-transparent px-0.5 py-0.5 text-xs text-[color:var(--text-1)] placeholder:text-[color:var(--text-2)] focus:outline-none"
        />
      </div>
    </div>
  );
}

const toMemoryRef = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-_]/g, "");

export function FrontmatterForm({ meta, onChange, readonly = false }: FrontmatterFormProps) {
  const { t } = useTranslation();
  const [localId, setLocalId] = useState(meta.id);
  const [pendingRename, setPendingRename] = useState<{ from: string; to: string } | null>(null);

  useEffect(() => {
    setLocalId(meta.id);
  }, [meta.id]);

  const update = (partial: Partial<MemoryMeta>) => {
    onChange({ ...meta, ...partial });
  };

  const requestIdChange = () => {
    if (readonly) return;
    const trimmed = localId.trim();
    if (!trimmed || trimmed === meta.id) {
      setLocalId(meta.id);
      return;
    }
    setPendingRename({ from: meta.id, to: trimmed });
  };

  const confirmIdChange = () => {
    if (!pendingRename) return;
    update({ id: pendingRename.to });
    setPendingRename(null);
  };

  const cancelIdChange = () => {
    setPendingRename(null);
    setLocalId(meta.id);
  };

  const addUnique = (list: string[], rawValue: string, normalize = true) => {
    const value = normalize ? toMemoryRef(rawValue) : rawValue.trim().toLowerCase();
    if (!value || list.includes(value)) return list;
    return [...list, value];
  };

  const isSkill = meta.system_role === "skill";

  return (
    <div className="space-y-3 p-3">
      {/* Identity */}
      <Field label={t("memoryEditor.frontmatter.id")}>
        <input
          type="text"
          value={localId}
          onChange={(e) => setLocalId(toMemoryRef(e.target.value))}
          onBlur={requestIdChange}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.currentTarget.blur();
            } else if (e.key === "Escape") {
              setLocalId(meta.id);
              e.currentTarget.blur();
            }
          }}
          disabled={readonly}
          className="w-full rounded-md border border-[var(--border)] bg-[color:var(--bg-2)] px-2 py-1.5 text-xs text-[color:var(--text-0)] placeholder:text-[color:var(--text-2)]"
          placeholder={t("memoryEditor.frontmatter.memoryIdPlaceholder")}
        />
        <p className="mt-1 text-[10px] leading-4 text-[color:var(--text-2)]">
          {t("memoryEditor.frontmatter.idHint")}
        </p>
      </Field>

      {pendingRename && (
        <RenameIdDialog
          fromId={pendingRename.from}
          toId={pendingRename.to}
          onCancel={cancelIdChange}
          onConfirm={confirmIdChange}
        />
      )}

      {meta.status && (
        <Field label={t("memoryEditor.frontmatter.status")}>
          <span
            className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${
              meta.status === "unprocessed"
                ? "bg-[color:var(--warning)]/12 text-[color:var(--warning)]"
                : "bg-[color:var(--success)]/12 text-[color:var(--success)]"
            }`}
          >
            {meta.status === "unprocessed"
              ? t("memoryEditor.frontmatter.unprocessed")
              : t("memoryEditor.frontmatter.processed")}
          </span>
        </Field>
      )}

      <Field label={t("memoryEditor.frontmatter.type")}>
        <select
          value={meta.type}
          onChange={(e) => update({ type: e.target.value as MemoryOntology })}
          disabled={readonly}
          className="w-full rounded-md border border-[var(--border)] bg-[color:var(--bg-2)] px-2 py-1.5 text-xs text-[color:var(--text-1)]"
        >
          {(["source", "entity", "concept", "synthesis", "unknown"] as MemoryOntology[]).map((ontology) => (
            <option key={ontology} value={ontology}>
              {t(`ontologies.${ontology}`)}
            </option>
          ))}
        </select>
      </Field>


      <label className="flex items-center gap-2 text-xs text-[color:var(--text-1)]">
        <input
          type="checkbox"
          checked={meta.protected}
          onChange={(e) => update({ protected: e.target.checked })}
          className="accent-[color:var(--accent)]"
        />
        {t("memoryEditor.frontmatter.protect")}
      </label>

      <div className="border-t border-[var(--border)]" />

      {/* Scores */}
      <Slider
        label={t("memoryEditor.frontmatter.importance")}
        value={meta.importance}
        min={0}
        max={1}
        step={0.05}
        disabled={readonly}
        onChange={(v) => update({ importance: v })}
      />
      <Slider
        label={t("memoryEditor.frontmatter.confidence")}
        value={meta.confidence}
        min={0}
        max={1}
        step={0.05}
        disabled={readonly}
        onChange={(v) => update({ confidence: v })}
      />
      <Slider
        label={t("memoryEditor.frontmatter.decay")}
        value={meta.decay_rate}
        min={0.95}
        max={0.9999}
        step={0.0001}
        disabled={readonly}
        onChange={(v) => update({ decay_rate: v })}
        precision={4}
      />

      <div className="border-t border-[var(--border)]" />

      {/* Content */}
      <Field label={t("memoryEditor.frontmatter.l0Summary")}>
        <input
          type="text"
          value={meta.l0}
          onChange={(e) => update({ l0: e.target.value })}
          disabled={readonly}
          placeholder={t("memoryEditor.frontmatter.l0Placeholder")}
          className="w-full rounded-md border border-[var(--border)] bg-[color:var(--bg-2)] px-2 py-1.5 text-xs text-[color:var(--text-0)] placeholder:text-[color:var(--text-2)]"
        />
      </Field>

      <ChipEditor
        label={t("memoryEditor.frontmatter.tags")}
        values={meta.tags}
        placeholder={t("memoryEditor.frontmatter.addTag")}
        disabled={readonly}
        onAdd={(value) => update({ tags: addUnique(meta.tags, value, false) })}
        onRemove={(value) => update({ tags: meta.tags.filter((tag) => tag !== value) })}
      />
      <ChipEditor
        label={t("memoryEditor.frontmatter.related")}
        values={meta.related}
        placeholder={t("memoryEditor.frontmatter.memoryIdEllipsis")}
        disabled={readonly}
        onAdd={(value) => update({ related: addUnique(meta.related, value) })}
        onRemove={(value) => update({ related: meta.related.filter((item) => item !== value) })}
      />
      <ChipEditor
        label={t("memoryEditor.frontmatter.derivedFrom")}
        values={meta.derived_from}
        placeholder={t("memoryEditor.frontmatter.sourceIdEllipsis")}
        disabled={readonly}
        onAdd={(value) => update({ derived_from: addUnique(meta.derived_from, value) })}
        onRemove={(value) =>
          update({ derived_from: meta.derived_from.filter((item) => item !== value) })}
      />

      {isSkill && (
        <>
          <div className="border-t border-[var(--border)]" />
          <ChipEditor
            label={t("memoryEditor.frontmatter.triggers")}
            values={meta.triggers}
            placeholder={t("memoryEditor.frontmatter.triggerPhrase")}
            disabled={readonly}
            onAdd={(value) => update({ triggers: addUnique(meta.triggers, value, false) })}
            onRemove={(value) => update({ triggers: meta.triggers.filter((item) => item !== value) })}
          />
          <Field label={t("memoryEditor.frontmatter.outputFormat")}>
            <input
              type="text"
              value={meta.output_format ?? ""}
              onChange={(e) => update({ output_format: e.target.value.trim() || null })}
              disabled={readonly}
              placeholder={t("memoryEditor.frontmatter.outputFormatPlaceholder")}
              className="w-full rounded-md border border-[var(--border)] bg-[color:var(--bg-2)] px-2 py-1.5 text-xs text-[color:var(--text-0)] placeholder:text-[color:var(--text-2)]"
            />
          </Field>
          <ChipEditor
            label={t("memoryEditor.frontmatter.requires")}
            values={meta.requires}
            placeholder={t("memoryEditor.frontmatter.requiredMemoryId")}
            disabled={readonly}
            onAdd={(value) => update({ requires: addUnique(meta.requires, value) })}
            onRemove={(value) => update({ requires: meta.requires.filter((item) => item !== value) })}
          />
          <ChipEditor
            label={t("memoryEditor.frontmatter.optional")}
            values={meta.optional}
            placeholder={t("memoryEditor.frontmatter.optionalMemoryId")}
            disabled={readonly}
            onAdd={(value) => update({ optional: addUnique(meta.optional, value) })}
            onRemove={(value) => update({ optional: meta.optional.filter((item) => item !== value) })}
          />
        </>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <span className="text-[10px] text-[color:var(--text-2)]">{label}</span>
      {children}
    </div>
  );
}

function RenameIdDialog({
  fromId,
  toId,
  onCancel,
  onConfirm,
}: {
  fromId: string;
  toId: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  const memories = useAppStore((s) => s.memories);
  const [backlinks, setBacklinks] = useState<BacklinkRef[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const refs = await getBacklinks(fromId);
        if (!cancelled) setBacklinks(refs);
      } catch {
        if (!cancelled) setBacklinks([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fromId]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        onConfirm();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onCancel, onConfirm]);

  const protectedIds = useMemo(() => {
    const byId = new Map(memories.map((m) => [m.id, m]));
    return (backlinks ?? [])
      .filter((ref) => byId.get(ref.source_id)?.protected)
      .map((ref) => ref.source_id);
  }, [backlinks, memories]);

  const occurrenceCount = useMemo(
    () => (backlinks ?? []).reduce((sum, ref) => sum + ref.occurrences.length, 0),
    [backlinks],
  );
  const sourceCount = backlinks?.length ?? 0;
  const loading = backlinks === null;

  const handleBackdropClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (event.target === event.currentTarget) onCancel();
    },
    [onCancel],
  );

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
            <FileSymlink className="h-4 w-4 text-[color:var(--accent)]" />
          </div>
          <h2 className="text-sm font-semibold text-[color:var(--text-0)]">
            {t("memoryEditor.frontmatter.renameIdTitle")}
          </h2>
        </div>

        <p className="mb-3 text-xs leading-5 text-[color:var(--text-2)]">
          {t("memoryEditor.frontmatter.renameIdDescription")}
        </p>

        <div className="mb-3 space-y-1.5 rounded-md border border-[color:var(--border)] bg-[color:var(--bg-2)] p-3">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[10px] uppercase tracking-[0.12em] text-[color:var(--text-2)]">
              {t("memoryEditor.frontmatter.renameIdOldLabel")}
            </span>
            <span className="truncate font-mono text-[11px] text-[color:var(--text-1)]">
              {fromId}
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[10px] uppercase tracking-[0.12em] text-[color:var(--text-2)]">
              {t("memoryEditor.frontmatter.renameIdNewLabel")}
            </span>
            <span className="truncate font-mono text-[11px] font-semibold text-[color:var(--accent)]">
              {toId}
            </span>
          </div>
        </div>

        <div className="mb-4 rounded-md border border-[color:var(--border)] bg-[color:var(--bg-2)] p-3">
          {loading && (
            <p className="text-xs text-[color:var(--text-2)]">
              {t("memoryEditor.frontmatter.renameIdImpactLoading")}
            </p>
          )}
          {!loading && sourceCount === 0 && (
            <p className="text-xs text-[color:var(--text-2)]">
              {t("memoryEditor.frontmatter.renameIdImpactNone")}
            </p>
          )}
          {!loading && sourceCount > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-[color:var(--text-1)]">
                {t("memoryEditor.frontmatter.renameIdImpact", { count: sourceCount })}
                {" · "}
                <span className="text-[color:var(--text-2)]">
                  {t("memoryEditor.frontmatter.renameIdImpactOccurrences", {
                    count: occurrenceCount,
                  })}
                </span>
              </p>
              <div>
                <p className="mb-1 text-[10px] uppercase tracking-[0.12em] text-[color:var(--text-2)]">
                  {t("memoryEditor.frontmatter.renameIdPreviewTitle")}
                </p>
                <ul className="max-h-28 space-y-0.5 overflow-y-auto pr-1 text-[11px] text-[color:var(--text-1)]">
                  {backlinks!.map((ref) => {
                    const isProtected = protectedIds.includes(ref.source_id);
                    return (
                      <li
                        key={ref.source_id}
                        className="flex items-center justify-between gap-2 font-mono"
                      >
                        <span className="truncate">{ref.source_id}</span>
                        <span className="shrink-0 text-[10px] text-[color:var(--text-2)]">
                          {isProtected
                            ? "—"
                            : ref.occurrences.length}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          )}
          {!loading && protectedIds.length > 0 && (
            <div className="mt-2 flex items-start gap-1.5 rounded-sm bg-[color:var(--warning)]/10 px-2 py-1.5 text-[11px] text-[color:var(--warning)]">
              <AlertTriangle className="mt-[1px] h-3 w-3 shrink-0" />
              <span>{t("memoryEditor.frontmatter.renameIdProtectedWarning")}</span>
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-md border border-[color:var(--border)] bg-[color:var(--bg-2)] px-4 py-1.5 text-xs font-medium text-[color:var(--text-1)] transition-colors hover:border-[color:var(--border-active)]"
          >
            {t("memoryEditor.frontmatter.renameIdCancel")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex-1 rounded-md bg-[color:var(--accent)] px-4 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
          >
            {t("memoryEditor.frontmatter.renameIdConfirm")}
          </button>
        </div>
      </div>
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  disabled = false,
  onChange,
  precision = 2,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  onChange: (value: number) => void;
  precision?: number;
}) {
  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-[color:var(--text-2)]">{label}</span>
        <span className="font-mono text-[10px] text-[color:var(--text-2)]">
          {value.toFixed(precision)}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full"
        style={{ accentColor: "var(--accent)" }}
      />
    </div>
  );
}
