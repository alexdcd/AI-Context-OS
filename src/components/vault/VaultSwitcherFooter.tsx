import { useEffect, useRef, useState } from "react";
import { Database } from "lucide-react";
import { clsx } from "clsx";
import { useVaultStore } from "../../lib/vaultStore";
import { VaultPopover } from "./VaultPopover";

interface Props {
  onCreateNew: () => void;
}

export function VaultSwitcherFooter({ onCreateNew }: Props) {
  const { vaults, activeVaultPath, popoverOpen, setPopoverOpen, loadVaults } =
    useVaultStore();
  const [showTooltip, setShowTooltip] = useState(false);
  const tooltipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load vault list on mount
  useEffect(() => {
    void loadVaults();
  }, [loadVaults]);

  const activeVault = vaults.find((v) => v.path === activeVaultPath);
  const displayName =
    activeVault?.name ??
    (activeVaultPath
      ? activeVaultPath.split("/").pop() ?? "Vault"
      : "Vault");

  const handleMouseEnter = () => {
    tooltipTimer.current = setTimeout(() => setShowTooltip(true), 300);
  };
  const handleMouseLeave = () => {
    if (tooltipTimer.current) clearTimeout(tooltipTimer.current);
    setShowTooltip(false);
  };

  return (
    <div className="relative flex w-full justify-center">
      <button
        onClick={() => setPopoverOpen(!popoverOpen)}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className={clsx(
          "flex h-8 w-8 items-center justify-center rounded-md transition-colors",
          popoverOpen
            ? "bg-[color:var(--accent-muted)] text-[color:var(--accent)]"
            : "text-[color:var(--text-2)] hover:bg-[color:var(--bg-2)] hover:text-[color:var(--text-1)]",
        )}
      >
        <Database className="h-[18px] w-[18px]" />
      </button>

      {/* Tooltip */}
      {showTooltip && !popoverOpen && (
        <div className="pointer-events-none absolute left-[calc(100%+0.5rem)] top-1/2 z-50 -translate-y-1/2 whitespace-nowrap rounded-md border border-[color:var(--border)] bg-[color:var(--bg-1)] px-2.5 py-1 text-xs font-medium text-[color:var(--text-0)] shadow-sm">
          {displayName}
        </div>
      )}

      {/* Popover */}
      {popoverOpen && (
        <VaultPopover
          onClose={() => setPopoverOpen(false)}
          onCreateNew={onCreateNew}
        />
      )}
    </div>
  );
}
