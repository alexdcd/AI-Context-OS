import { useState } from "react";
import type { MemoryMeta, MemoryType } from "../../lib/types";
import { MEMORY_TYPE_LABELS } from "../../lib/types";

interface FrontmatterFormProps {
  meta: MemoryMeta;
  onChange: (meta: MemoryMeta) => void;
}

interface ChipEditorProps {
  label: string;
  values: string[];
  placeholder: string;
  onAdd: (value: string) => void;
  onRemove: (value: string) => void;
}

function ChipEditor({
  label,
  values,
  placeholder,
  onAdd,
  onRemove,
}: ChipEditorProps) {
  const [input, setInput] = useState("");

  const commit = () => {
    const value = input.trim();
    if (!value) return;
    onAdd(value);
    setInput("");
  };

  return (
    <div className="space-y-1.5">
      <span className="text-[10px] uppercase tracking-[0.12em] text-[color:var(--text-2)]">
        {label}
      </span>
      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[color:var(--bg-2)]/55 px-2 py-2">
        {values.map((value) => (
          <span
            key={value}
            className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]"
            style={{
              borderColor: "var(--border)",
              color: "var(--text-1)",
              backgroundColor: "var(--bg-3)",
            }}
          >
            {value}
            <button
              type="button"
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
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              commit();
            }
          }}
          placeholder={placeholder}
          className="min-w-[88px] flex-1 bg-transparent px-1 py-0.5 text-xs text-[color:var(--text-1)] placeholder:text-[color:var(--text-2)] focus:outline-none"
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

export function FrontmatterForm({ meta, onChange }: FrontmatterFormProps) {
  const update = (partial: Partial<MemoryMeta>) => {
    onChange({ ...meta, ...partial });
  };

  const addUnique = (list: string[], rawValue: string, normalize = true) => {
    const value = normalize ? toMemoryRef(rawValue) : rawValue.trim().toLowerCase();
    if (!value || list.includes(value)) return list;
    return [...list, value];
  };

  const isSkill = meta.memory_type === "skill";

  return (
    <div className="space-y-3 p-3">
      <section className="space-y-2 rounded-lg border border-[var(--border)] bg-[color:var(--bg-1)]/75 p-2.5">
        <div className="space-y-1">
          <span className="text-[10px] uppercase tracking-[0.12em] text-[color:var(--text-2)]">ID</span>
          <input
            type="text"
            value={meta.id}
            onChange={(e) => update({ id: toMemoryRef(e.target.value) })}
            className="w-full rounded-lg border border-[var(--border)] bg-[color:var(--bg-2)] px-2 py-1.5 text-xs text-[color:var(--text-0)] focus:border-[color:var(--accent)] focus:outline-none"
            placeholder="memory-id"
          />
        </div>

        <div className="space-y-1">
          <span className="text-[10px] uppercase tracking-[0.12em] text-[color:var(--text-2)]">
            Type
          </span>
          <select
            value={meta.memory_type}
            onChange={(e) => update({ memory_type: e.target.value as MemoryType })}
            className="w-full rounded-lg border bg-[color:var(--bg-2)] px-2 py-1.5 text-xs text-[color:var(--text-1)]"
            style={{ borderColor: "var(--border)" }}
          >
            {(Object.keys(MEMORY_TYPE_LABELS) as MemoryType[]).map((t) => (
              <option key={t} value={t}>
                {MEMORY_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>

        <label className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[color:var(--bg-2)]/45 px-2 py-1.5 text-xs text-[color:var(--text-1)]">
          <input
            type="checkbox"
            checked={meta.always_load}
            onChange={(e) => update({ always_load: e.target.checked })}
            className="accent-[color:var(--accent)]"
          />
          Always load
        </label>
      </section>

      <section className="space-y-2 rounded-lg border border-[var(--border)] bg-[color:var(--bg-1)]/75 p-2.5">
        <div className="space-y-1">
          <span className="text-[10px] uppercase tracking-[0.12em] text-[color:var(--text-2)]">
            Importance ({meta.importance.toFixed(2)})
          </span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={meta.importance}
            onChange={(e) => update({ importance: parseFloat(e.target.value) })}
            className="w-full"
            style={{ accentColor: "var(--accent)" }}
          />
        </div>
        <div className="space-y-1">
          <span className="text-[10px] uppercase tracking-[0.12em] text-[color:var(--text-2)]">
            Confidence ({meta.confidence.toFixed(2)})
          </span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={meta.confidence}
            onChange={(e) => update({ confidence: parseFloat(e.target.value) })}
            className="w-full"
            style={{ accentColor: "var(--accent)" }}
          />
        </div>
        <div className="space-y-1">
          <span className="text-[10px] uppercase tracking-[0.12em] text-[color:var(--text-2)]">
            Decay Rate ({meta.decay_rate.toFixed(4)})
          </span>
          <input
            type="range"
            min="0.95"
            max="0.9999"
            step="0.0001"
            value={meta.decay_rate}
            onChange={(e) => update({ decay_rate: parseFloat(e.target.value) })}
            className="w-full"
            style={{ accentColor: "var(--accent)" }}
          />
        </div>
      </section>

      <section className="space-y-2 rounded-lg border border-[var(--border)] bg-[color:var(--bg-1)]/75 p-2.5">
        <div className="space-y-1">
          <span className="text-[10px] uppercase tracking-[0.12em] text-[color:var(--text-2)]">
            L0 Summary
          </span>
          <input
            type="text"
            value={meta.l0}
            onChange={(e) => update({ l0: e.target.value })}
            placeholder="Resumen de una línea..."
            className="w-full rounded-lg border border-[var(--border)] bg-[color:var(--bg-2)] px-2 py-1.5 text-xs text-[color:var(--text-0)] placeholder:text-[color:var(--text-2)] focus:border-[color:var(--accent)] focus:outline-none"
          />
        </div>

        <ChipEditor
          label="Tags"
          values={meta.tags}
          placeholder="Añadir tag..."
          onAdd={(value) =>
            update({
              tags: addUnique(meta.tags, value, false),
            })
          }
          onRemove={(value) => update({ tags: meta.tags.filter((tag) => tag !== value) })}
        />
        <ChipEditor
          label="Related"
          values={meta.related}
          placeholder="memory-id..."
          onAdd={(value) =>
            update({
              related: addUnique(meta.related, value),
            })
          }
          onRemove={(value) =>
            update({ related: meta.related.filter((item) => item !== value) })
          }
        />
      </section>

      {isSkill && (
        <section className="space-y-2 rounded-lg border border-[var(--border)] bg-[color:var(--bg-1)]/75 p-2.5">
          <ChipEditor
            label="Triggers"
            values={meta.triggers}
            placeholder="frase de activación..."
            onAdd={(value) =>
              update({
                triggers: addUnique(meta.triggers, value, false),
              })
            }
            onRemove={(value) =>
              update({ triggers: meta.triggers.filter((item) => item !== value) })
            }
          />
          <div className="space-y-1">
            <span className="text-[10px] uppercase tracking-[0.12em] text-[color:var(--text-2)]">
              Output Format
            </span>
            <input
            type="text"
            value={meta.output_format ?? ""}
            onChange={(e) => update({ output_format: e.target.value.trim() || null })}
            placeholder="markdown / json / text..."
            className="w-full rounded-lg border border-[var(--border)] bg-[color:var(--bg-2)] px-2 py-1.5 text-xs text-[color:var(--text-0)] placeholder:text-[color:var(--text-2)] focus:border-[color:var(--accent)] focus:outline-none"
          />
        </div>
          <ChipEditor
            label="Requires"
            values={meta.requires}
            placeholder="memory-id requerido..."
            onAdd={(value) =>
              update({
                requires: addUnique(meta.requires, value),
              })
            }
            onRemove={(value) =>
              update({ requires: meta.requires.filter((item) => item !== value) })
            }
          />
          <ChipEditor
            label="Optional"
            values={meta.optional}
            placeholder="memory-id opcional..."
            onAdd={(value) =>
              update({
                optional: addUnique(meta.optional, value),
              })
            }
            onRemove={(value) =>
              update({ optional: meta.optional.filter((item) => item !== value) })
            }
          />
        </section>
      )}
    </div>
  );
}
