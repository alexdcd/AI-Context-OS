import { useEffect, useRef } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Check, X, FolderOpen, Plus } from "lucide-react";
import { clsx } from "clsx";
import { useTranslation } from "react-i18next";
import { useVaultStore } from "../../lib/vaultStore";
import type { VaultEntry } from "../../lib/types";

interface Props {
  onClose: () => void;
  onCreateNew: () => void;
}

export function VaultPopover({ onClose, onCreateNew }: Props) {
  const { t } = useTranslation();
  const { vaults, activeVaultPath, requestSwitch, removeVault } =
    useVaultStore();

  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const handleOpenExisting = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected !== "string" || !selected.trim()) return;
    onClose();
    await useVaultStore.getState().addVaultAndSwitch(selected);
  };

  const handleSwitch = (vault: VaultEntry) => {
    if (vault.path === activeVaultPath) return;
    onClose();
    requestSwitch(vault);
  };

  const handleRemove = async (e: React.MouseEvent, vault: VaultEntry) => {
    e.stopPropagation();
    await removeVault(vault.path);
  };

  return (
    <div
      ref={ref}
      className="absolute bottom-0 left-[calc(100%+0.5rem)] z-50 w-64 overflow-hidden rounded-lg border border-[color:var(--border)] bg-[color:var(--bg-1)] shadow-xl"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[color:var(--border)] px-3 py-2">
        <span className="text-xs font-semibold text-[color:var(--text-0)]">
          {t("vault.title")}
        </span>
        <button
          onClick={onClose}
          className="rounded p-0.5 text-[color:var(--text-2)] hover:text-[color:var(--text-0)]"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Vault list */}
      <div className="max-h-56 overflow-y-auto py-1">
        {vaults.length === 0 && (
          <p className="px-3 py-2 text-xs text-[color:var(--text-2)]">
            No vaults yet
          </p>
        )}
        {vaults.map((vault) => {
          const isActive = vault.path === activeVaultPath;
          return (
            <div
              key={vault.path}
              onClick={() => handleSwitch(vault)}
              className={clsx(
                "group flex cursor-pointer items-center gap-2 px-3 py-2 transition-colors",
                isActive
                  ? "bg-[color:var(--accent-muted)]"
                  : "hover:bg-[color:var(--bg-2)]",
              )}
            >
              {/* Active check */}
              <div className="flex h-4 w-4 shrink-0 items-center justify-center">
                {isActive ? (
                  <Check className="h-3.5 w-3.5 text-[color:var(--accent)]" />
                ) : (
                  <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--bg-3)]" />
                )}
              </div>

              {/* Name + count */}
              <div className="min-w-0 flex-1">
                <p
                  className={clsx(
                    "truncate text-xs font-medium",
                    isActive
                      ? "text-[color:var(--accent)]"
                      : "text-[color:var(--text-0)]",
                  )}
                >
                  {vault.name}
                </p>
                <p className="text-[10px] text-[color:var(--text-2)]">
                  {vault.memory_count}{" "}
                  {t("vault.memories", { count: vault.memory_count })}
                </p>
              </div>

              {/* Remove button — only on hover, hidden for active */}
              {!isActive && (
                <button
                  onClick={(e) => void handleRemove(e, vault)}
                  className="hidden shrink-0 rounded p-0.5 text-[color:var(--text-2)] transition-colors hover:text-[color:var(--danger)] group-hover:flex"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer actions */}
      <div className="border-t border-[color:var(--border)] py-1">
        <button
          onClick={() => void handleOpenExisting()}
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-[color:var(--text-1)] transition-colors hover:bg-[color:var(--bg-2)]"
        >
          <FolderOpen className="h-3.5 w-3.5 shrink-0 text-[color:var(--text-2)]" />
          {t("vault.openExisting")}
        </button>
        <button
          onClick={() => { onClose(); onCreateNew(); }}
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-[color:var(--text-1)] transition-colors hover:bg-[color:var(--bg-2)]"
        >
          <Plus className="h-3.5 w-3.5 shrink-0 text-[color:var(--text-2)]" />
          {t("vault.createNew")}
        </button>
      </div>
    </div>
  );
}
