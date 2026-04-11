import { useVaultStore } from "../../lib/vaultStore";
import { useTranslation } from "react-i18next";
import { Database, ArrowRight } from "lucide-react";

export function VaultConfirmDialog() {
  const { t } = useTranslation();
  const { switchPhase, switchTarget, confirmSwitch, cancelSwitch } =
    useVaultStore();

  if (switchPhase !== "confirming" || !switchTarget) return null;

  return (
    <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-lg border border-[color:var(--border)] bg-[color:var(--bg-1)] p-5 shadow-xl">
        {/* Header */}
        <div className="mb-4 flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-[color:var(--accent-muted)]">
            <Database className="h-4 w-4 text-[color:var(--accent)]" />
          </div>
          <h2 className="text-sm font-semibold text-[color:var(--text-0)]">
            {t("vault.switchConfirmTitle", { name: switchTarget.name })}
          </h2>
        </div>

        {/* Vault info */}
        <div className="mb-4 rounded-md border border-[color:var(--border)] bg-[color:var(--bg-2)] p-3 space-y-1.5">
          <div className="flex items-center gap-2">
            <ArrowRight className="h-3 w-3 shrink-0 text-[color:var(--accent)]" />
            <span className="truncate font-mono text-[11px] text-[color:var(--text-1)]">
              {switchTarget.path}
            </span>
          </div>
          <p className="text-[11px] text-[color:var(--text-2)]">
            {switchTarget.memory_count} {t("vault.memories", { count: switchTarget.memory_count })}
            {switchTarget.template
              ? ` · ${switchTarget.template}`
              : ""}
          </p>
        </div>

        <p className="mb-5 text-xs text-[color:var(--text-2)]">
          {t("vault.switchConfirmDesc")}
        </p>

        {/* Actions */}
        <div className="flex gap-2">
          <button
            onClick={cancelSwitch}
            className="flex-1 rounded-md border border-[color:var(--border)] bg-[color:var(--bg-2)] px-4 py-1.5 text-xs font-medium text-[color:var(--text-1)] transition-colors hover:border-[color:var(--border-active)]"
          >
            {t("vault.cancel")}
          </button>
          <button
            onClick={() => void confirmSwitch()}
            className="flex-1 rounded-md bg-[color:var(--accent)] px-4 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
          >
            {t("vault.switchAction")}
          </button>
        </div>
      </div>
    </div>
  );
}
