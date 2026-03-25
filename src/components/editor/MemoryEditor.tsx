import { useState, useEffect, useCallback, useMemo } from "react";
import { FileText, PanelRightClose, PanelRightOpen, Save, Trash2 } from "lucide-react";
import { clsx } from "clsx";
import { useAppStore } from "../../lib/store";
import { FrontmatterForm } from "./FrontmatterForm";
import { TipTapEditor } from "./TipTapEditor";
import type { MemoryMeta } from "../../lib/types";

type EditorMode = "both" | "l1" | "l2";

export function MemoryEditor() {
  const { activeMemory, saveActiveMemory, deleteMemory, loading } = useAppStore();
  const [meta, setMeta] = useState<MemoryMeta | null>(null);
  const [l1, setL1] = useState("");
  const [l2, setL2] = useState("");
  const [dirty, setDirty] = useState(false);
  const [mode, setMode] = useState<EditorMode>("both");
  const [showInspector, setShowInspector] = useState(true);

  useEffect(() => {
    if (activeMemory) {
      setMeta(activeMemory.meta);
      setL1(activeMemory.l1_content);
      setL2(activeMemory.l2_content);
      setDirty(false);
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

  if (!activeMemory || !meta) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-[color:var(--text-2)]">
        <div className="rounded-xl border border-[var(--border)] bg-[color:var(--bg-2)]/45 p-4">
          <FileText className="h-10 w-10 text-sky-300/80" />
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
        <div className="hidden items-center gap-1 rounded-lg border border-[var(--border)] bg-[color:var(--bg-1)]/70 p-1 md:flex">
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
          className="rounded-lg border border-[var(--border)] bg-[color:var(--bg-2)]/65 px-2.5 py-1.5 text-[color:var(--text-1)] transition-colors hover:text-[color:var(--text-0)]"
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
          className="inline-flex items-center gap-1.5 rounded-lg border border-red-700/40 bg-red-950/35 px-2.5 py-1.5 text-xs font-medium text-red-200 transition-colors hover:bg-red-900/40 disabled:opacity-50"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete
        </button>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={!dirty || loading}
          className={clsx(
            "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
            dirty
              ? "bg-sky-600 text-white hover:bg-sky-500"
              : "cursor-not-allowed bg-[color:var(--bg-3)] text-[color:var(--text-2)]",
          )}
        >
          <Save className="h-3.5 w-3.5" />
          {dirty ? "Save" : "Saved"}
        </button>
      </div>

      <div className="flex min-h-0 flex-1 gap-2 p-2">
        <div className="min-w-0 flex-1 overflow-y-auto rounded-xl border border-[var(--border)] bg-[color:var(--bg-1)]/55 p-3">
          <div className="mb-3 flex items-center justify-between rounded-lg border border-[var(--border)] bg-[color:var(--bg-2)]/55 px-3 py-2">
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
                tone="sky"
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
                tone="emerald"
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
          <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[color:var(--bg-1)]/65">
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
              <InspectorMetric label="Links" value={String(meta.related.length)} />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <FrontmatterForm meta={meta} onChange={handleMetaChange} />
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
      className={clsx(
        "rounded-md px-2 py-1 text-xs transition-colors",
        active
          ? "bg-sky-500/20 text-sky-200"
          : "text-[color:var(--text-2)] hover:text-[color:var(--text-0)]",
      )}
    >
      {label}
    </button>
  );
}

function EditorSection({
  title,
  hint,
  tone,
  children,
}: {
  title: string;
  hint: string;
  tone: "sky" | "emerald";
  children: React.ReactNode;
}) {
  const toneClasses =
    tone === "sky"
      ? "border-sky-500/25 bg-sky-500/8 text-sky-200"
      : "border-emerald-500/25 bg-emerald-500/8 text-emerald-200";
  return (
    <section className="space-y-2">
      <div
        className={clsx(
          "flex items-center justify-between rounded-lg border px-3 py-2",
          toneClasses,
        )}
      >
        <p className="text-xs font-semibold uppercase tracking-[0.12em]">{title}</p>
        <p className="text-[11px] opacity-80">{hint}</p>
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
