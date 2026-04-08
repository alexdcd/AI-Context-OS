import { useState, useCallback } from "react";
import { useSettingsStore, Theme } from "../lib/settingsStore";
import { Monitor, Moon, Sun, Download, Upload, Check, Loader2, Eye, EyeOff } from "lucide-react";
import { clsx } from "clsx";
import { backupWorkspace, restoreWorkspace } from "../lib/tauri";
import { save, open } from "@tauri-apps/plugin-dialog";
import { useAppStore } from "../lib/store";

export function SettingsView() {
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
    const ok = window.confirm(
      "Restore backup? Current files will be overwritten."
    );
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
  }, [initialize]);

  const themeOptions: { value: Theme; label: string; icon: typeof Monitor; describe: string }[] = [
    { value: "system", label: "System", icon: Monitor, describe: "Follows your operating system's appearance" },
    { value: "light", label: "Light", icon: Sun, describe: "Always use light theme" },
    { value: "dark", label: "Dark", icon: Moon, describe: "Always use dark theme" },
  ];

  return (
    <div className="h-full overflow-y-auto p-8">
      <div className="mx-auto max-w-2xl space-y-6">
        <h1 className="mb-8 text-2xl font-semibold text-[color:var(--text-0)]">Settings</h1>

        {/* Appearance */}
        <section className="obs-panel border border-[color:var(--border)] p-6">
          <h2 className="mb-4 text-lg font-medium text-[color:var(--text-0)]">Appearance</h2>

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

        <section className="obs-panel border border-[color:var(--border)] p-6">
          <h2 className="mb-1 text-lg font-medium text-[color:var(--text-0)]">Explorer</h2>
          <p className="mb-4 text-sm text-[color:var(--text-2)]">
            Enable advanced explorer controls only if you want to work with internal files.
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
                  <div className="font-medium text-[color:var(--text-0)]">Expert mode</div>
                  <p className="mt-2 text-sm text-[color:var(--text-2)]">
                    {expertModeEnabled
                      ? "Advanced controls are now available on this screen and at the bottom of the explorer."
                      : "Hides internal files and prevents visual noise for most users."}
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
                  <span className="font-medium text-[color:var(--text-0)]">Show system files</span>
                  <span
                    className={clsx(
                      "rounded-full px-2 py-0.5 text-[11px] font-medium",
                      showSystemFiles
                        ? "bg-[color:var(--accent)] text-white"
                        : "bg-[color:var(--bg-2)] text-[color:var(--text-2)]"
                    )}
                  >
                    {showSystemFiles ? "Active" : "Hidden"}
                  </span>
                </div>
                <p className="mt-2 text-sm text-[color:var(--text-2)]">
                  {showSystemFiles
                    ? "You will see YAML, JSONL, claude.md and other advanced artifacts alongside memories."
                    : "Keeps the explorer focused on memories, although expert mode remains available."}
                </p>
              </div>
            </button>
          )}
        </section>

        {/* Backup / Restore */}
        <section className="obs-panel border border-[color:var(--border)] p-6">
          <h2 className="mb-1 text-lg font-medium text-[color:var(--text-0)]">Backup & Restore</h2>
          <p className="mb-4 text-sm text-[color:var(--text-2)]">
            Export or import your entire workspace as a .zip file
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
                <span className="font-medium text-[color:var(--text-1)]">Export backup</span>
                <p className="mt-0.5 text-sm text-[color:var(--text-2)]">
                  {backupStatus === "done"
                    ? "Backup created successfully"
                    : backupStatus === "error"
                      ? "Error creating backup"
                      : "Save a backup of the entire workspace"}
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
                <span className="font-medium text-[color:var(--text-1)]">Restore backup</span>
                <p className="mt-0.5 text-sm text-[color:var(--text-2)]">
                  {restoreStatus === "done"
                    ? "Workspace restored successfully"
                    : restoreStatus === "error"
                      ? "Error restoring backup"
                      : "Import a .zip file to replace the current workspace"}
                </p>
              </div>
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
