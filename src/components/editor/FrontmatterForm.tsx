import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { MemoryMeta, MemoryOntology } from "../../lib/types";

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

  const update = (partial: Partial<MemoryMeta>) => {
    onChange({ ...meta, ...partial });
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
          value={meta.id}
          onChange={(e) => update({ id: toMemoryRef(e.target.value) })}
          disabled={readonly}
          className="w-full rounded-md border border-[var(--border)] bg-[color:var(--bg-2)] px-2 py-1.5 text-xs text-[color:var(--text-0)] placeholder:text-[color:var(--text-2)]"
          placeholder={t("memoryEditor.frontmatter.memoryIdPlaceholder")}
        />
      </Field>

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
          value={meta.ontology}
          onChange={(e) => update({ ontology: e.target.value as MemoryOntology })}
          disabled={readonly}
          className="w-full rounded-md border border-[var(--border)] bg-[color:var(--bg-2)] px-2 py-1.5 text-xs text-[color:var(--text-1)]"
        >
          {(["source", "entity", "concept", "synthesis"] as MemoryOntology[]).map((ontology) => (
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
