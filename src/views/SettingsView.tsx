import { useState, useCallback } from "react";
import { useSettingsStore, Theme } from "../lib/settingsStore";
import { Monitor, Moon, Sun, Download, Upload, Check, Loader2, Eye, EyeOff } from "lucide-react";
import { clsx } from "clsx";
import { backupWorkspace, restoreWorkspace } from "../lib/tauri";
import { save, open } from "@tauri-apps/plugin-dialog";
import { useAppStore } from "../lib/store";
import { useTranslation } from "react-i18next";
import { type Language } from "../lib/settingsStore";
import { VaultSettingsSection } from "../components/vault/VaultSettingsSection";
import { UpdateSection } from "../components/settings/UpdateSection";

export function SettingsView() {
  const { t } = useTranslation();
  // Access showOnboardingForVault trigger via window event — avoids prop drilling
  const handleCreateNew = () =>
    window.dispatchEvent(new CustomEvent("vault:create-new"));
  const language = useSettingsStore((s) => s.language);
  const setLanguage = useSettingsStore((s) => s.setLanguage);
  const theme = useSettingsStore((s) => s.theme);
  const expertModeEnabled = useSettingsStore((s) => s.expertModeEnabled);
  const showSystemFiles = useSettingsStore((s) => s.showSystemFiles);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const setExpertModeEnabled = useSettingsStore((s) => s.setExpertModeEnabled);
  const setShowSystemFiles = useSettingsStore((s) => s.setShowSystemFiles);
  const initialize = useAppStore((s) => s.initialize);

  const [backupStatus, setBackupStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [restoreStatus, setRestoreStatus] = useState<"idle" | "loading" | "done" | "error">("idle");

  const handleBackup = useCallback(async () => {
    const dest = await save({
      defaultPath: `ai-context-os-backup-${new Date().toISOString().slice(0, 10)}.zip`,
      filters: [{ name: "Zip", extensions: ["zip"] }],
    });
    if (!dest) return;
    setBackupStatus("loading");
    try {
      await backupWorkspace(dest);
      setBackupStatus("done");
      setTimeout(() => setBackupStatus("idle"), 2000);
    } catch {
      setBackupStatus("error");
      setTimeout(() => setBackupStatus("idle"), 3000);
    }
  }, []);

  const handleRestore = useCallback(async () => {
    const result = await open({
      filters: [{ name: "Zip", extensions: ["zip"] }],
      multiple: false,
    });
    if (!result) return;
    const ok = window.confirm(t("settings.backup.restoreConfirm"));
    if (!ok) return;
    setRestoreStatus("loading");
    try {
      await restoreWorkspace(result);
      setRestoreStatus("done");
      initialize();
      setTimeout(() => setRestoreStatus("idle"), 2000);
    } catch {
      setRestoreStatus("error");
      setTimeout(() => setRestoreStatus("idle"), 3000);
    }
  }, [initialize, t]);

  const themeOptions: { value: Theme; label: string; icon: typeof Monitor; describe: string }[] = [
    { value: "system", label: t("settings.theme.system"), icon: Monitor, describe: t("settings.theme.systemDesc") },
    { value: "light",  label: t("settings.theme.light"),  icon: Sun,     describe: t("settings.theme.lightDesc") },
    { value: "dark",   label: t("settings.theme.dark"),   icon: Moon,    describe: t("settings.theme.darkDesc") },
  ];

  return (
    <div className="h-full overflow-y-auto p-8">
      <div className="mx-auto max-w-2xl space-y-6">
        <h1 className="mb-8 text-2xl font-semibold text-[color:var(--text-0)]">{t("settings.title")}</h1>

        {/* Workspace / Vault section */}
        <VaultSettingsSection onCreateNew={handleCreateNew} />

        {/* Appearance */}
        <section className="obs-panel border border-[color:var(--border)] p-6">
          <h2 className="mb-4 text-lg font-medium text-[color:var(--text-0)]">{t("settings.appearance")}</h2>

          <div className="flex flex-col gap-3">
            {themeOptions.map((option) => {
              const isActive = theme === option.value;
              return (
                <button
                  key={option.value}
                  onClick={() => setTheme(option.value)}
                  className={clsx(
                    "flex flex-col items-start rounded-md border p-4 text-left transition-colors",
                    isActive
                      ? "border-[color:var(--accent)] bg-[color:var(--accent-muted)]"
                      : "border-[color:var(--border)] bg-[color:var(--bg-0)] hover:border-[color:var(--border-active)]"
                  )}
                >
                  <div className="flex w-full items-center justify-between">
                    <div className="flex items-center gap-3">
                      <option.icon
                        className={clsx(
                          "h-5 w-5",
                          isActive ? "text-[color:var(--accent)]" : "text-[color:var(--text-1)]"
                        )}
                      />
                      <span
                        className={clsx(
                          "font-medium",
                          isActive ? "text-[color:var(--text-0)]" : "text-[color:var(--text-1)]"
                        )}
                      >
                        {option.label}
                      </span>
                    </div>
                    {isActive && (
                      <div className="h-2 w-2 rounded-full bg-[color:var(--accent)]" />
                    )}
                  </div>
                  <p className="mt-2 text-sm text-[color:var(--text-2)]">{option.describe}</p>
                </button>
              );
            })}
          </div>
        </section>

        {/* Language */}
        <section className="obs-panel border border-[color:var(--border)] p-6">
          <h2 className="mb-4 text-lg font-medium text-[color:var(--text-0)]">
            {t("settings.language.label")}
          </h2>
          <div className="flex gap-2">
            {(["en", "es"] as Language[]).map((lang) => (
              <button
                key={lang}
                onClick={() => setLanguage(lang)}
                className={clsx(
                  "rounded-md border px-4 py-1.5 text-sm font-medium transition-colors",
                  language === lang
                    ? "border-[color:var(--accent)] bg-[color:var(--accent-muted)] text-[color:var(--accent)]"
                    : "border-[var(--border)] bg-[color:var(--bg-2)] text-[color:var(--text-1)] hover:border-[var(--border-active)]",
                )}
              >
                {t(`settings.language.${lang}` as const)}
              </button>
            ))}
          </div>
        </section>

        <section className="obs-panel border border-[color:var(--border)] p-6">
          <h2 className="mb-1 text-lg font-medium text-[color:var(--text-0)]">{t("settings.explorer.label")}</h2>
          <p className="mb-4 text-sm text-[color:var(--text-2)]">
            {t("settings.explorer.expertModeDesc")}
          </p>

          <button
            onClick={() => setExpertModeEnabled(!expertModeEnabled)}
            className={clsx(
              "flex w-full items-start gap-3 rounded-md border p-4 text-left transition-colors",
              expertModeEnabled
                ? "border-[color:var(--accent)] bg-[color:var(--accent-muted)]"
                : "border-[color:var(--border)] bg-[color:var(--bg-0)] hover:border-[color:var(--border-active)]"
            )}
          >
            <div className="flex-1">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-medium text-[color:var(--text-0)]">{t("settings.explorer.expertMode")}</div>
                  <p className="mt-2 text-sm text-[color:var(--text-2)]">
                    {expertModeEnabled
                      ? t("settings.explorer.expertModeActive")
                      : t("settings.explorer.showSystemFilesDesc")}
                  </p>
                </div>
                <span
                  className={clsx(
                    "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
                    expertModeEnabled ? "bg-[color:var(--accent)]" : "bg-[color:var(--bg-3)]"
                  )}
                >
                  <span
                    className={clsx(
                      "inline-block h-4 w-4 rounded-full bg-white transition-transform",
                      expertModeEnabled ? "translate-x-6" : "translate-x-1"
                    )}
                  />
                </span>
              </div>
            </div>
          </button>

          {expertModeEnabled && (
            <button
              onClick={() => setShowSystemFiles(!showSystemFiles)}
              className={clsx(
                "mt-3 flex w-full items-start gap-3 rounded-md border p-4 text-left transition-colors",
                showSystemFiles
                  ? "border-[color:var(--accent)] bg-[color:var(--accent-muted)]"
                  : "border-[color:var(--border)] bg-[color:var(--bg-0)] hover:border-[color:var(--border-active)]"
              )}
            >
              <div className="mt-0.5">
                {showSystemFiles ? (
                  <Eye className="h-5 w-5 text-[color:var(--accent)]" />
                ) : (
                  <EyeOff className="h-5 w-5 text-[color:var(--text-2)]" />
                )}
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-[color:var(--text-0)]">{t("settings.explorer.showSystemFiles")}</span>
                  <span
                    className={clsx(
                      "rounded-full px-2 py-0.5 text-[11px] font-medium",
                      showSystemFiles
                        ? "bg-[color:var(--accent)] text-white"
                        : "bg-[color:var(--bg-2)] text-[color:var(--text-2)]"
                    )}
                  >
                    {showSystemFiles ? t("settings.explorer.showSystemFilesActive") : t("settings.explorer.showSystemFilesHidden")}
                  </span>
                </div>
                <p className="mt-2 text-sm text-[color:var(--text-2)]">
                  {showSystemFiles
                    ? t("settings.explorer.showSystemFilesVisible")
                    : t("settings.explorer.showSystemFilesHiddenDesc")}
                </p>
              </div>
            </button>
          )}
        </section>

        {/* Updates */}
        <UpdateSection />

        {/* Backup / Restore */}
        <section className="obs-panel border border-[color:var(--border)] p-6">
          <h2 className="mb-1 text-lg font-medium text-[color:var(--text-0)]">{t("settings.backup.title")}</h2>
          <p className="mb-4 text-sm text-[color:var(--text-2)]">
            {t("settings.backup.desc")}
          </p>

          <div className="flex flex-col gap-3">
            <button
              onClick={() => void handleBackup()}
              disabled={backupStatus === "loading"}
              className="flex items-center gap-3 rounded-md border border-[color:var(--border)] bg-[color:var(--bg-0)] p-4 text-left transition-colors hover:border-[color:var(--border-active)]"
            >
              {backupStatus === "loading" ? (
                <Loader2 className="h-5 w-5 animate-spin text-[color:var(--accent)]" />
              ) : backupStatus === "done" ? (
                <Check className="h-5 w-5 text-[color:var(--success)]" />
              ) : (
                <Download className="h-5 w-5 text-[color:var(--text-1)]" />
              )}
              <div>
                <span className="font-medium text-[color:var(--text-1)]">{t("settings.backup.export")}</span>
                <p className="mt-0.5 text-sm text-[color:var(--text-2)]">
                  {backupStatus === "done"
                    ? t("settings.backup.exportSuccess")
                    : backupStatus === "error"
                      ? t("settings.backup.exportError")
                      : t("settings.backup.exportDesc")}
                </p>
              </div>
            </button>

            <button
              onClick={() => void handleRestore()}
              disabled={restoreStatus === "loading"}
              className="flex items-center gap-3 rounded-md border border-[color:var(--border)] bg-[color:var(--bg-0)] p-4 text-left transition-colors hover:border-[color:var(--border-active)]"
            >
              {restoreStatus === "loading" ? (
                <Loader2 className="h-5 w-5 animate-spin text-[color:var(--accent)]" />
              ) : restoreStatus === "done" ? (
                <Check className="h-5 w-5 text-[color:var(--success)]" />
              ) : (
                <Upload className="h-5 w-5 text-[color:var(--text-1)]" />
              )}
              <div>
                <span className="font-medium text-[color:var(--text-1)]">{t("settings.backup.restore")}</span>
                <p className="mt-0.5 text-sm text-[color:var(--text-2)]">
                  {restoreStatus === "done"
                    ? t("settings.backup.restoreSuccess")
                    : restoreStatus === "error"
                      ? t("settings.backup.restoreError")
                      : t("settings.backup.restoreDesc")}
                </p>
              </div>
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
