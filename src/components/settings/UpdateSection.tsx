import { useState, useCallback } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { RefreshCw, Download, RotateCcw, Check, Loader2, AlertCircle } from "lucide-react";
import { clsx } from "clsx";
import { useTranslation } from "react-i18next";

type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "up-to-date"
  | "error";

export function UpdateSection() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<UpdateStatus>("idle");
  const [update, setUpdate] = useState<Update | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const handleCheck = useCallback(async () => {
    setStatus("checking");
    setError(null);
    try {
      const result = await check();
      if (result) {
        setUpdate(result);
        setStatus("available");
      } else {
        setStatus("up-to-date");
        setTimeout(() => setStatus("idle"), 3000);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }, []);

  const handleDownloadAndInstall = useCallback(async () => {
    if (!update) return;
    setStatus("downloading");
    setProgress(0);
    try {
      let totalBytes = 0;
      let downloadedBytes = 0;
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          totalBytes = event.data.contentLength ?? 0;
        } else if (event.event === "Progress") {
          downloadedBytes += event.data.chunkLength;
          if (totalBytes > 0) {
            setProgress(Math.round((downloadedBytes / totalBytes) * 100));
          }
        } else if (event.event === "Finished") {
          setProgress(100);
        }
      });
      setStatus("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }, [update]);

  const handleRelaunch = useCallback(async () => {
    await relaunch();
  }, []);

  return (
    <section className="obs-panel border border-[color:var(--border)] p-6">
      <h2 className="mb-1 text-lg font-medium text-[color:var(--text-0)]">
        {t("settings.update.title")}
      </h2>
      <p className="mb-4 text-sm text-[color:var(--text-2)]">
        {t("settings.update.desc")}
      </p>

      <div className="flex flex-col gap-3">
        {/* Check for updates */}
        {(status === "idle" || status === "checking" || status === "up-to-date" || status === "error") && (
          <button
            onClick={() => void handleCheck()}
            disabled={status === "checking"}
            className="flex items-center gap-3 rounded-md border border-[color:var(--border)] bg-[color:var(--bg-0)] p-4 text-left transition-colors hover:border-[color:var(--border-active)]"
          >
            {status === "checking" ? (
              <Loader2 className="h-5 w-5 animate-spin text-[color:var(--accent)]" />
            ) : status === "up-to-date" ? (
              <Check className="h-5 w-5 text-[color:var(--success)]" />
            ) : status === "error" ? (
              <AlertCircle className="h-5 w-5 text-[color:var(--danger)]" />
            ) : (
              <RefreshCw className="h-5 w-5 text-[color:var(--text-1)]" />
            )}
            <div>
              <span className="font-medium text-[color:var(--text-1)]">
                {t("settings.update.check")}
              </span>
              <p className="mt-0.5 text-sm text-[color:var(--text-2)]">
                {status === "checking"
                  ? t("settings.update.checking")
                  : status === "up-to-date"
                    ? t("settings.update.upToDate")
                    : status === "error"
                      ? error ?? t("settings.update.error")
                      : t("settings.update.checkDesc")}
              </p>
            </div>
          </button>
        )}

        {/* Update available — download */}
        {status === "available" && update && (
          <button
            onClick={() => void handleDownloadAndInstall()}
            className="flex items-center gap-3 rounded-md border border-[color:var(--accent)] bg-[color:var(--accent-muted)] p-4 text-left transition-colors hover:opacity-90"
          >
            <Download className="h-5 w-5 text-[color:var(--accent)]" />
            <div>
              <span className="font-medium text-[color:var(--text-0)]">
                {t("settings.update.available", { version: update.version })}
              </span>
              <p className="mt-0.5 text-sm text-[color:var(--text-2)]">
                {t("settings.update.downloadInstall")}
              </p>
            </div>
          </button>
        )}

        {/* Downloading progress */}
        {status === "downloading" && (
          <div className="rounded-md border border-[color:var(--border)] bg-[color:var(--bg-0)] p-4">
            <div className="flex items-center gap-3 mb-3">
              <Loader2 className="h-5 w-5 animate-spin text-[color:var(--accent)]" />
              <div>
                <span className="font-medium text-[color:var(--text-1)]">
                  {t("settings.update.downloading")}
                </span>
                <p className="mt-0.5 text-sm text-[color:var(--text-2)]">
                  {progress}%
                </p>
              </div>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-[color:var(--bg-3)]">
              <div
                className={clsx(
                  "h-full rounded-full bg-[color:var(--accent)] transition-all duration-300",
                )}
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {/* Ready to restart */}
        {status === "ready" && (
          <button
            onClick={() => void handleRelaunch()}
            className="flex items-center gap-3 rounded-md border border-[color:var(--success)] bg-[color:var(--success-muted,var(--accent-muted))] p-4 text-left transition-colors hover:opacity-90"
          >
            <RotateCcw className="h-5 w-5 text-[color:var(--success)]" />
            <div>
              <span className="font-medium text-[color:var(--text-0)]">
                {t("settings.update.ready")}
              </span>
              <p className="mt-0.5 text-sm text-[color:var(--text-2)]">
                {t("settings.update.readyDesc")}
              </p>
            </div>
          </button>
        )}
      </div>
    </section>
  );
}
