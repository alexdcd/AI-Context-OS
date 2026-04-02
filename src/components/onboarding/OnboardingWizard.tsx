import { useState } from "react";
import {
  Brain,
  Code,
  Pen,
  Briefcase,
  ChevronRight,
  ChevronLeft,
  FolderOpen,
  User,
  Sparkles,
  Loader2,
} from "lucide-react";
import { clsx } from "clsx";
import { runOnboarding, type OnboardingProfile } from "../../lib/tauri";

const TEMPLATES = [
  {
    id: "developer",
    label: "Desarrollador",
    icon: Code,
    desc: "Code review, debugging, arquitectura. Convenciones y stack.",
  },
  {
    id: "creator",
    label: "Creador",
    icon: Pen,
    desc: "Escritura, LinkedIn, newsletters, repurposing. Marca y voz.",
  },
  {
    id: "entrepreneur",
    label: "Emprendedor",
    icon: Briefcase,
    desc: "Análisis estratégico, actas, priorización. Restricciones.",
  },
  {
    id: "custom",
    label: "Personalizado",
    icon: Sparkles,
    desc: "Workspace vacío. Configúralo a tu manera.",
  },
];

interface Props {
  onComplete: () => void;
}

export function OnboardingWizard({ onComplete }: Props) {
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [language, setLanguage] = useState("es");
  const [template, setTemplate] = useState("developer");
  const [rootDir, setRootDir] = useState("~/AI-Context-OS");

  const steps = ["Ubicación", "Perfil", "Template", "Confirmar"];

  const canNext = () => {
    if (step === 0) return rootDir.trim().length > 0;
    if (step === 1) return name.trim().length > 0 && role.trim().length > 0;
    if (step === 2) return template.length > 0;
    return true;
  };

  const handleFinish = async () => {
    setLoading(true);
    setError(null);
    try {
      const profile: OnboardingProfile = {
        name,
        role,
        tools: [],
        language,
        template,
        root_dir: rootDir !== "~/AI-Context-OS" ? rootDir : undefined,
      };
      await runOnboarding(profile);
      onComplete();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-screen items-center justify-center bg-[color:var(--bg-0)]">
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="mb-6 flex items-center gap-2.5 px-1">
          <Brain className="h-5 w-5 text-[color:var(--accent)]" />
          <h1 className="text-base font-semibold text-[color:var(--text-0)]">
            AI Context OS
          </h1>
        </div>

        {/* Progress */}
        <div className="mb-6 flex gap-1 px-1">
          {steps.map((s, i) => (
            <div key={s} className="flex-1">
              <div
                className={clsx(
                  "h-0.5 rounded-full transition-colors",
                  i <= step ? "bg-[color:var(--accent)]" : "bg-[color:var(--bg-3)]",
                )}
              />
              <p
                className={clsx(
                  "mt-1.5 text-[10px]",
                  i === step ? "text-[color:var(--text-0)]" : "text-[color:var(--text-2)]",
                )}
              >
                {s}
              </p>
            </div>
          ))}
        </div>

        {/* Card */}
        <div className="rounded-lg border border-[var(--border)] bg-[color:var(--bg-1)]">
          <div className="min-h-[280px] px-5 py-5">
            {step === 0 && (
              <div className="space-y-4">
                <div>
                  <h2 className="text-sm font-medium text-[color:var(--text-0)]">
                    Ubicación del workspace
                  </h2>
                  <p className="mt-1 text-xs text-[color:var(--text-2)]">
                    Se creará una carpeta con 9 subdirectorios para tu memoria de IA.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <FolderOpen className="h-4 w-4 shrink-0 text-[color:var(--text-2)]" />
                  <input
                    value={rootDir}
                    onChange={(e) => setRootDir(e.target.value)}
                    className="flex-1 rounded-md border border-[var(--border)] bg-[color:var(--bg-2)] px-3 py-2 text-sm text-[color:var(--text-0)] placeholder:text-[color:var(--text-2)]"
                    placeholder="~/AI-Context-OS"
                  />
                </div>
                <p className="font-mono text-[11px] text-[color:var(--text-2)]">
                  01-context/ · 02-daily/ · 03-intelligence/ · 04-projects/ · 05-resources/ · 06-skills/ · 07-tasks/ · 08-rules/ · 09-scratch/
                </p>
              </div>
            )}

            {step === 1 && (
              <div className="space-y-4">
                <div>
                  <h2 className="text-sm font-medium text-[color:var(--text-0)]">Tu perfil</h2>
                  <p className="mt-1 text-xs text-[color:var(--text-2)]">
                    Se guardará como memoria de contexto para tus IAs.
                  </p>
                </div>
                <div className="space-y-3">
                  <div>
                    <label className="mb-1 block text-xs text-[color:var(--text-2)]">Nombre</label>
                    <div className="flex items-center gap-2">
                      <User className="h-4 w-4 shrink-0 text-[color:var(--text-2)]" />
                      <input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="flex-1 rounded-md border border-[var(--border)] bg-[color:var(--bg-2)] px-3 py-2 text-sm text-[color:var(--text-0)] placeholder:text-[color:var(--text-2)]"
                        placeholder="Tu nombre"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-[color:var(--text-2)]">
                      Rol / Profesión
                    </label>
                    <input
                      value={role}
                      onChange={(e) => setRole(e.target.value)}
                      className="w-full rounded-md border border-[var(--border)] bg-[color:var(--bg-2)] px-3 py-2 text-sm text-[color:var(--text-0)] placeholder:text-[color:var(--text-2)]"
                      placeholder="ej. Full-stack developer, CEO startup..."
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-[color:var(--text-2)]">Idioma</label>
                    <select
                      value={language}
                      onChange={(e) => setLanguage(e.target.value)}
                      className="w-full rounded-md border border-[var(--border)] bg-[color:var(--bg-2)] px-3 py-2 text-sm text-[color:var(--text-0)]"
                    >
                      <option value="es">Español</option>
                      <option value="en">English</option>
                      <option value="pt">Português</option>
                    </select>
                  </div>
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-4">
                <div>
                  <h2 className="text-sm font-medium text-[color:var(--text-0)]">Template</h2>
                  <p className="mt-1 text-xs text-[color:var(--text-2)]">
                    Skills y reglas prediseñadas. Personalizables después.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {TEMPLATES.map((t) => {
                    const Icon = t.icon;
                    const selected = template === t.id;
                    return (
                      <button
                        key={t.id}
                        onClick={() => setTemplate(t.id)}
                        className={clsx(
                          "rounded-md border p-3 text-left transition-colors",
                          selected
                            ? "border-[color:var(--accent)] bg-[color:var(--accent-muted)]"
                            : "border-[var(--border)] bg-[color:var(--bg-2)] hover:border-[var(--border-active)]",
                        )}
                      >
                        <Icon
                          className={clsx(
                            "mb-1.5 h-4 w-4",
                            selected ? "text-[color:var(--accent)]" : "text-[color:var(--text-2)]",
                          )}
                        />
                        <p className="text-xs font-medium text-[color:var(--text-0)]">{t.label}</p>
                        <p className="mt-0.5 text-[11px] leading-tight text-[color:var(--text-2)]">
                          {t.desc}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-4">
                <h2 className="text-sm font-medium text-[color:var(--text-0)]">Resumen</h2>
                <div className="space-y-2 rounded-md border border-[var(--border)] bg-[color:var(--bg-2)] p-3 text-xs">
                  <Row label="Nombre" value={name} />
                  <Row label="Rol" value={role} />
                  <Row label="Template" value={template} />
                  <Row label="Ubicación" value={rootDir} mono />
                </div>
                <p className="text-xs text-[color:var(--text-2)]">
                  Se creará el workspace con memorias iniciales y archivos de integración
                  auto-generados.
                </p>
                {error && (
                  <p className="rounded-md bg-[color:var(--danger)]/10 px-3 py-2 text-xs text-[color:var(--danger)]">
                    {error}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between border-t border-[var(--border)] px-5 py-3">
            <button
              onClick={() => setStep((s) => s - 1)}
              disabled={step === 0}
              className="flex items-center gap-1 text-xs text-[color:var(--text-2)] hover:text-[color:var(--text-0)] disabled:invisible"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Atrás
            </button>

            {step < 3 ? (
              <button
                onClick={() => setStep((s) => s + 1)}
                disabled={!canNext()}
                className="flex items-center gap-1 rounded-md bg-[color:var(--accent)] px-4 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-30"
              >
                Siguiente
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            ) : (
              <button
                onClick={handleFinish}
                disabled={loading}
                className="flex items-center gap-1.5 rounded-md bg-[color:var(--accent)] px-4 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Creando...
                  </>
                ) : (
                  "Crear Workspace"
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-[color:var(--text-2)]">{label}</span>
      <span className={clsx("text-right text-[color:var(--text-0)]", mono && "font-mono")}>
        {value}
      </span>
    </div>
  );
}
