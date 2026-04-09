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
import { useTranslation } from "react-i18next";
import { runOnboarding, type OnboardingProfile } from "../../lib/tauri";
import { useSettingsStore } from "../../lib/settingsStore";

interface Props {
  onComplete: () => void;
}

export function OnboardingWizard({ onComplete }: Props) {
  const { t } = useTranslation();
  const setLanguage = useSettingsStore((s) => s.setLanguage);

  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [language, setLang] = useState("es");
  const [template, setTemplate] = useState("developer");
  const [rootDir, setRootDir] = useState("~/AI-Context-OS");

  const TEMPLATES = [
    { id: "developer",    label: t("onboarding.template.developer"),    icon: Code,      desc: t("onboarding.template.developerDesc") },
    { id: "creator",      label: t("onboarding.template.creator"),      icon: Pen,       desc: t("onboarding.template.creatorDesc") },
    { id: "entrepreneur", label: t("onboarding.template.entrepreneur"), icon: Briefcase, desc: t("onboarding.template.entrepreneurDesc") },
    { id: "custom",       label: t("onboarding.template.custom"),       icon: Sparkles,  desc: t("onboarding.template.customDesc") },
  ];

  const steps = [
    t("onboarding.steps.location"),
    t("onboarding.steps.profile"),
    t("onboarding.steps.template"),
    t("onboarding.steps.confirm"),
  ];

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
      setLanguage(language as "en" | "es");
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
                    {t("onboarding.location.title")}
                  </h2>
                  <p className="mt-1 text-xs text-[color:var(--text-2)]">
                    {t("onboarding.location.desc")}
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
                  {t("onboarding.location.structure")}
                </p>
              </div>
            )}

            {step === 1 && (
              <div className="space-y-4">
                <div>
                  <h2 className="text-sm font-medium text-[color:var(--text-0)]">
                    {t("onboarding.profile.title")}
                  </h2>
                  <p className="mt-1 text-xs text-[color:var(--text-2)]">
                    {t("onboarding.profile.desc")}
                  </p>
                </div>
                <div className="space-y-3">
                  <div>
                    <label className="mb-1 block text-xs text-[color:var(--text-2)]">
                      {t("onboarding.profile.nameLabel")}
                    </label>
                    <div className="flex items-center gap-2">
                      <User className="h-4 w-4 shrink-0 text-[color:var(--text-2)]" />
                      <input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="flex-1 rounded-md border border-[var(--border)] bg-[color:var(--bg-2)] px-3 py-2 text-sm text-[color:var(--text-0)] placeholder:text-[color:var(--text-2)]"
                        placeholder={t("onboarding.profile.namePlaceholder")}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-[color:var(--text-2)]">
                      {t("onboarding.profile.roleLabel")}
                    </label>
                    <input
                      value={role}
                      onChange={(e) => setRole(e.target.value)}
                      className="w-full rounded-md border border-[var(--border)] bg-[color:var(--bg-2)] px-3 py-2 text-sm text-[color:var(--text-0)] placeholder:text-[color:var(--text-2)]"
                      placeholder={t("onboarding.profile.rolePlaceholder")}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-[color:var(--text-2)]">
                      {t("onboarding.profile.languageLabel")}
                    </label>
                    <select
                      value={language}
                      onChange={(e) => setLang(e.target.value)}
                      className="w-full rounded-md border border-[var(--border)] bg-[color:var(--bg-2)] px-3 py-2 text-sm text-[color:var(--text-0)]"
                    >
                      <option value="en">{t("onboarding.profile.en")}</option>
                      <option value="es">{t("onboarding.profile.es")}</option>
                    </select>
                  </div>
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-4">
                <div>
                  <h2 className="text-sm font-medium text-[color:var(--text-0)]">
                    {t("onboarding.template.title")}
                  </h2>
                  <p className="mt-1 text-xs text-[color:var(--text-2)]">
                    {t("onboarding.template.desc")}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {TEMPLATES.map((tmpl) => {
                    const Icon = tmpl.icon;
                    const selected = template === tmpl.id;
                    return (
                      <button
                        key={tmpl.id}
                        onClick={() => setTemplate(tmpl.id)}
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
                        <p className="text-xs font-medium text-[color:var(--text-0)]">{tmpl.label}</p>
                        <p className="mt-0.5 text-[11px] leading-tight text-[color:var(--text-2)]">
                          {tmpl.desc}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-4">
                <h2 className="text-sm font-medium text-[color:var(--text-0)]">
                  {t("onboarding.confirm.title")}
                </h2>
                <div className="space-y-2 rounded-md border border-[var(--border)] bg-[color:var(--bg-2)] p-3 text-xs">
                  <Row label="Name" value={name} />
                  <Row label="Role" value={role} />
                  <Row label="Template" value={template} />
                  <Row label="Location" value={rootDir} mono />
                </div>
                <p className="text-xs text-[color:var(--text-2)]">
                  {t("onboarding.confirm.desc")}
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
              {t("onboarding.actions.back")}
            </button>

            {step < 3 ? (
              <button
                onClick={() => setStep((s) => s + 1)}
                disabled={!canNext()}
                className="flex items-center gap-1 rounded-md bg-[color:var(--accent)] px-4 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-30"
              >
                {t("onboarding.actions.next")}
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
                    {t("onboarding.actions.creating")}
                  </>
                ) : (
                  t("onboarding.actions.create")
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
