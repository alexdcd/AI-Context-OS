import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Database, FolderOpen, Plus, Trash2, Check } from "lucide-react";
import { clsx } from "clsx";
import { useTranslation } from "react-i18next";
import { useVaultStore } from "../../lib/vaultStore";
import { getConfig } from "../../lib/tauri";
import type { Config, VaultEntry } from "../../lib/types";

export function VaultSettingsSection({ onCreateNew }: { onCreateNew: () => void }) {
  const { t } = useTranslation();
  const { vaults, activeVaultPath, loadVaults, requestSwitch, removeVault } =
    useVaultStore();
  const [config, setConfig] = useState<Config | null>(null);
  const [removeConfirm, setRemoveConfirm] = useState<string | null>(null);

  useEffect(() => {
    void loadVaults();
    getConfig().then(setConfig).catch(() => {});
  }, [loadVaults]);

  const activeVault = vaults.find((v) => v.path === activeVaultPath);

  const handleOpenExisting = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected !== "string" || !selected.trim()) return;
    await useVaultStore.getState().addVaultAndSwitch(selected);
  };

  const handleRemove = async (vault: VaultEntry) => {
    if (removeConfirm === vault.path) {
      await removeVault(vault.path);
      setRemoveConfirm(null);
    } else {
      setRemoveConfirm(vault.path);
      // Auto-cancel after 3s
      setTimeout(() => setRemoveConfirm(null), 3000);
    }
  };

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch {
      return iso;
    }
  };

  return (
    <section className="obs-panel border border-[color:var(--border)] p-6">
      <h2 className="mb-1 text-lg font-medium text-[color:var(--text-0)]">
        {t("vault.settingsTitle")}
      </h2>
      <p className="mb-5 text-sm text-[color:var(--text-2)]">
        {t("vault.currentVault")}
      </p>

      {/* Active vault info card */}
      {(activeVault ?? config) && (
        <div className="mb-5 rounded-md border border-[color:var(--accent)]/30 bg-[color:var(--accent-muted)] p-4">
          <div className="mb-2 flex items-center gap-2">
            <Database className="h-4 w-4 text-[color:var(--accent)]" />
            <span className="text-sm font-semibold text-[color:var(--text-0)]">
              {activeVault?.name ?? config?.root_dir?.split("/").pop() ?? "—"}
            </span>
            <span className="rounded-full bg-[color:var(--accent)] px-1.5 py-0.5 text-[10px] font-medium text-white">
              {t("vault.active")}
            </span>
          </div>
          <div className="space-y-1 text-xs text-[color:var(--text-2)]">
            <p>
              <span className="text-[color:var(--text-1)]">{t("vault.path")}: </span>
              <span className="font-mono">{config?.root_dir ?? activeVault?.path ?? "—"}</span>
            </p>
            <p>
              <span className="text-[color:var(--text-1)]">{t("vault.memories")}: </span>
              {activeVault?.memory_count ?? "—"}
            </p>
            {activeVault?.template && (
              <p>
                <span className="text-[color:var(--text-1)]">{t("vault.template")}: </span>
                {activeVault.template}
              </p>
            )}
            {activeVault?.last_accessed && (
              <p>
                <span className="text-[color:var(--text-1)]">{t("vault.lastAccessed")}: </span>
                {formatDate(activeVault.last_accessed)}
              </p>
            )}
          </div>
        </div>
      )}

      {/* All vaults list */}
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[color:var(--text-2)]">
        {t("vault.allVaults")}
      </h3>

      <div className="mb-4 space-y-1.5">
        {vaults.length === 0 && (
          <p className="text-xs text-[color:var(--text-2)]">No vaults registered.</p>
        )}
        {vaults.map((vault) => {
          const isActive = vault.path === activeVaultPath;
          return (
            <div
              key={vault.path}
              className={clsx(
                "flex items-center gap-3 rounded-md border p-3 transition-colors",
                isActive
                  ? "border-[color:var(--accent)]/30 bg-[color:var(--accent-muted)]"
                  : "border-[color:var(--border)] bg-[color:var(--bg-0)]",
              )}
            >
              {/* Active indicator */}
              <div className="flex h-5 w-5 shrink-0 items-center justify-center">
                {isActive ? (
                  <Check className="h-4 w-4 text-[color:var(--accent)]" />
                ) : (
                  <span className="h-2 w-2 rounded-full bg-[color:var(--bg-3)]" />
                )}
              </div>

              {/* Info */}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-[color:var(--text-0)]">
                  {vault.name}
                </p>
                <p className="truncate font-mono text-[11px] text-[color:var(--text-2)]">
                  {vault.path}
                </p>
                <p className="text-[11px] text-[color:var(--text-2)]">
                  {vault.memory_count} {t("vault.memories")}
                  {vault.template ? ` · ${vault.template}` : ""}
                  {vault.last_accessed
                    ? ` · ${formatDate(vault.last_accessed)}`
                    : ""}
                </p>
              </div>

              {/* Actions */}
              <div className="flex shrink-0 items-center gap-1.5">
                {!isActive && (
                  <button
                    onClick={() => requestSwitch(vault)}
                    className="rounded-md border border-[color:var(--border)] bg-[color:var(--bg-2)] px-2.5 py-1 text-xs font-medium text-[color:var(--text-1)] transition-colors hover:border-[color:var(--border-active)]"
                  >
                    {t("vault.switchAction")}
                  </button>
                )}
                {!isActive && (
                  <button
                    onClick={() => void handleRemove(vault)}
                    className={clsx(
                      "flex h-7 w-7 items-center justify-center rounded-md border transition-colors",
                      removeConfirm === vault.path
                        ? "border-[color:var(--danger)] bg-[color:var(--danger)]/10 text-[color:var(--danger)]"
                        : "border-[color:var(--border)] bg-[color:var(--bg-2)] text-[color:var(--text-2)] hover:border-[color:var(--danger)] hover:text-[color:var(--danger)]",
                    )}
                    title={
                      removeConfirm === vault.path
                        ? "Click again to confirm"
                        : t("vault.remove")
                    }
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Action buttons */}
      <div className="flex gap-2">
        <button
          onClick={() => void handleOpenExisting()}
          className="flex flex-1 items-center justify-center gap-2 rounded-md border border-[color:var(--border)] bg-[color:var(--bg-0)] px-4 py-2 text-xs font-medium text-[color:var(--text-1)] transition-colors hover:border-[color:var(--border-active)]"
        >
          <FolderOpen className="h-3.5 w-3.5" />
          {t("vault.openExisting")}
        </button>
        <button
          onClick={onCreateNew}
          className="flex flex-1 items-center justify-center gap-2 rounded-md border border-[color:var(--border)] bg-[color:var(--bg-0)] px-4 py-2 text-xs font-medium text-[color:var(--text-1)] transition-colors hover:border-[color:var(--border-active)]"
        >
          <Plus className="h-3.5 w-3.5" />
          {t("vault.createNew")}
        </button>
      </div>
    </section>
  );
}
