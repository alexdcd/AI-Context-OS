import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { clsx } from "clsx";
import {
  Monitor,
  Moon,
  Sun,
  Palette,
  Sparkles,
  Code2,
  RefreshCcw,
  FolderOpen,
  ExternalLink,
} from "lucide-react";
import {
  useSettingsStore,
  type AppearanceMode,
  type Theme,
} from "../../../lib/settingsStore";
import {
  ensureThemesDirectory,
  listVaultThemes,
  type VaultTheme,
} from "../../../lib/themeLoader";
import { showInFileManager } from "../../../lib/tauri";

export function AppearanceTab() {
  const { t } = useTranslation();
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const appearanceMode = useSettingsStore((s) => s.appearanceMode);
  const setAppearanceMode = useSettingsStore((s) => s.setAppearanceMode);
  const showMarkdownSyntax = useSettingsStore((s) => s.showMarkdownSyntax);
  const setShowMarkdownSyntax = useSettingsStore((s) => s.setShowMarkdownSyntax);
  const customThemeId = useSettingsStore((s) => s.customThemeId);
  const setCustomThemeId = useSettingsStore((s) => s.setCustomThemeId);

  const [themes, setThemes] = useState<VaultTheme[]>([]);
  const [themesRefreshing, setThemesRefreshing] = useState(false);
  const [themesPath, setThemesPath] = useState<string | null>(null);

  const refreshThemes = useCallback(async () => {
    const startedAt = Date.now();
    setThemesRefreshing(true);
    try {
      const list = await listVaultThemes();
      setThemes(list);
      setThemesPath(list[0]?.path.replace(/\/[^/]+$/, "") ?? null);
    } finally {
      const remaining = Math.max(0, 450 - (Date.now() - startedAt));
      window.setTimeout(() => {
        setThemesRefreshing(false);
      }, remaining);
    }
  }, []);

  useEffect(() => {
    void refreshThemes();
  }, [refreshThemes]);

  const handleCreateThemesFolder = useCallback(async () => {
    await ensureThemesDirectory();
    await refreshThemes();
  }, [refreshThemes]);

  const handleRevealThemes = useCallback(async () => {
    if (!themesPath) return;
    try {
      await showInFileManager(themesPath);
    } catch {
      /* noop */
    }
  }, [themesPath]);

  const themeOptions: {
    value: Theme;
    label: string;
    icon: typeof Monitor;
    describe: string;
  }[] = [
    { value: "system", label: t("settings.theme.system"), icon: Monitor, describe: t("settings.theme.systemDesc") },
    { value: "light",  label: t("settings.theme.light"),  icon: Sun,     describe: t("settings.theme.lightDesc") },
    { value: "dark",   label: t("settings.theme.dark"),   icon: Moon,    describe: t("settings.theme.darkDesc") },
  ];

  const modeOptions: {
    value: AppearanceMode;
    label: string;
    icon: typeof Sparkles;
    describe: string;
  }[] = [
    {
      value: "modern",
      label: t("settings.appearanceTab.modeModern"),
      icon: Sparkles,
      describe: t("settings.appearanceTab.modeModernDesc"),
    },
    {
      value: "classic",
      label: t("settings.appearanceTab.modeClassic"),
      icon: Palette,
      describe: t("settings.appearanceTab.modeClassicDesc"),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Light / Dark / System */}
      <section className="obs-panel border border-[color:var(--border)] p-6">
        <h2 className="mb-1 text-lg font-medium text-[color:var(--text-0)]">
          {t("settings.appearanceTab.colorScheme")}
        </h2>
        <p className="mb-4 text-sm text-[color:var(--text-2)]">
          {t("settings.appearanceTab.colorSchemeDesc")}
        </p>
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
                    : "border-[color:var(--border)] bg-[color:var(--bg-0)] hover:border-[color:var(--border-active)]",
                )}
              >
                <div className="flex w-full items-center justify-between">
                  <div className="flex items-center gap-3">
                    <option.icon
                      className={clsx(
                        "h-5 w-5",
                        isActive ? "text-[color:var(--accent)]" : "text-[color:var(--text-1)]",
                      )}
                    />
                    <span
                      className={clsx(
                        "font-medium",
                        isActive ? "text-[color:var(--text-0)]" : "text-[color:var(--text-1)]",
                      )}
                    >
                      {option.label}
                    </span>
                  </div>
                  {isActive && <div className="h-2 w-2 rounded-full bg-[color:var(--accent)]" />}
                </div>
                <p className="mt-2 text-sm text-[color:var(--text-2)]">{option.describe}</p>
              </button>
            );
          })}
        </div>
      </section>

      {/* Modern vs Classic */}
      <section className="obs-panel border border-[color:var(--border)] p-6">
        <h2 className="mb-1 text-lg font-medium text-[color:var(--text-0)]">
          {t("settings.appearanceTab.style")}
        </h2>
        <p className="mb-4 text-sm text-[color:var(--text-2)]">
          {t("settings.appearanceTab.styleDesc")}
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {modeOptions.map((option) => {
            const isActive = appearanceMode === option.value;
            return (
              <button
                key={option.value}
                onClick={() => setAppearanceMode(option.value)}
                className={clsx(
                  "flex h-full flex-col items-start rounded-md border p-4 text-left transition-colors",
                  isActive
                    ? "border-[color:var(--accent)] bg-[color:var(--accent-muted)]"
                    : "border-[color:var(--border)] bg-[color:var(--bg-0)] hover:border-[color:var(--border-active)]",
                )}
              >
                <div className="flex w-full items-center justify-between">
                  <div className="flex items-center gap-3">
                    <option.icon
                      className={clsx(
                        "h-5 w-5",
                        isActive ? "text-[color:var(--accent)]" : "text-[color:var(--text-1)]",
                      )}
                    />
                    <span
                      className={clsx(
                        "font-medium",
                        isActive ? "text-[color:var(--text-0)]" : "text-[color:var(--text-1)]",
                      )}
                    >
                      {option.label}
                    </span>
                  </div>
                  {isActive && <div className="h-2 w-2 rounded-full bg-[color:var(--accent)]" />}
                </div>
                <p className="mt-2 text-sm text-[color:var(--text-2)]">{option.describe}</p>
              </button>
            );
          })}
        </div>
      </section>

      {/* Markdown syntax toggle */}
      <section className="obs-panel border border-[color:var(--border)] p-6">
        <h2 className="mb-1 text-lg font-medium text-[color:var(--text-0)]">
          {t("settings.appearanceTab.markdown")}
        </h2>
        <p className="mb-4 text-sm text-[color:var(--text-2)]">
          {t("settings.appearanceTab.markdownDesc")}
        </p>
        <button
          onClick={() => setShowMarkdownSyntax(!showMarkdownSyntax)}
          className={clsx(
            "flex w-full items-start gap-3 rounded-md border p-4 text-left transition-colors",
            showMarkdownSyntax
              ? "border-[color:var(--accent)] bg-[color:var(--accent-muted)]"
              : "border-[color:var(--border)] bg-[color:var(--bg-0)] hover:border-[color:var(--border-active)]",
          )}
        >
          <Code2
            className={clsx(
              "mt-0.5 h-5 w-5",
              showMarkdownSyntax ? "text-[color:var(--accent)]" : "text-[color:var(--text-1)]",
            )}
          />
          <div className="flex-1">
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium text-[color:var(--text-0)]">
                {t("settings.appearanceTab.markdownToggle")}
              </span>
              <span
                className={clsx(
                  "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
                  showMarkdownSyntax ? "bg-[color:var(--accent)]" : "bg-[color:var(--bg-3)]",
                )}
              >
                <span
                  className={clsx(
                    "inline-block h-4 w-4 rounded-full bg-white transition-transform",
                    showMarkdownSyntax ? "translate-x-6" : "translate-x-1",
                  )}
                />
              </span>
            </div>
            <p className="mt-2 text-sm text-[color:var(--text-2)]">
              {showMarkdownSyntax
                ? t("settings.appearanceTab.markdownOn")
                : t("settings.appearanceTab.markdownOff")}
            </p>
          </div>
        </button>
      </section>

      {/* Custom vault themes */}
      <section className="obs-panel border border-[color:var(--border)] p-6">
        <div className="mb-1 flex items-center justify-between gap-3">
          <h2 className="text-lg font-medium text-[color:var(--text-0)]">
            {t("settings.appearanceTab.customThemes")}
          </h2>
          <button
            onClick={() => void refreshThemes()}
            disabled={themesRefreshing}
            className="flex items-center gap-1.5 rounded-md border border-[color:var(--border)] bg-[color:var(--bg-2)] px-2.5 py-1 text-xs text-[color:var(--text-1)] transition-colors hover:border-[color:var(--border-active)] disabled:opacity-50"
          >
            <RefreshCcw className={clsx("h-3.5 w-3.5", themesRefreshing && "spin")} />
            {t("settings.appearanceTab.refresh")}
          </button>
        </div>
        <p className="mb-4 text-sm text-[color:var(--text-2)]">
          {t("settings.appearanceTab.customThemesDesc")}
        </p>

        <div className="flex flex-col gap-3">
          <button
            onClick={() => setCustomThemeId(null)}
            className={clsx(
              "flex items-center justify-between rounded-md border p-3 text-left transition-colors",
              !customThemeId
                ? "border-[color:var(--accent)] bg-[color:var(--accent-muted)]"
                : "border-[color:var(--border)] bg-[color:var(--bg-0)] hover:border-[color:var(--border-active)]",
            )}
          >
            <span className="text-sm font-medium text-[color:var(--text-0)]">
              {t("settings.appearanceTab.customThemeNone")}
            </span>
            {!customThemeId && <div className="h-2 w-2 rounded-full bg-[color:var(--accent)]" />}
          </button>

          {themes.length === 0 ? (
            <div className="rounded-md border border-dashed border-[color:var(--border)] bg-[color:var(--bg-0)] p-4 text-sm text-[color:var(--text-2)]">
              <p>{t("settings.appearanceTab.customThemesEmpty")}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  onClick={() => void handleCreateThemesFolder()}
                  className="flex items-center gap-1.5 rounded-md border border-[color:var(--border)] bg-[color:var(--bg-2)] px-2.5 py-1 text-xs text-[color:var(--text-1)] transition-colors hover:border-[color:var(--border-active)]"
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                  {t("settings.appearanceTab.createFolder")}
                </button>
                <button
                  onClick={() => void showInFileManager("docs/themes.md")}
                  className="flex items-center gap-1.5 rounded-md border border-[color:var(--border)] bg-[color:var(--bg-2)] px-2.5 py-1 text-xs text-[color:var(--text-1)] transition-colors hover:border-[color:var(--border-active)]"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  {t("settings.appearanceTab.learnMore")}
                </button>
              </div>
            </div>
          ) : (
            themes.map((item) => {
              const isActive = customThemeId === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setCustomThemeId(item.id)}
                  className={clsx(
                    "flex items-center justify-between rounded-md border p-3 text-left transition-colors",
                    isActive
                      ? "border-[color:var(--accent)] bg-[color:var(--accent-muted)]"
                      : "border-[color:var(--border)] bg-[color:var(--bg-0)] hover:border-[color:var(--border-active)]",
                  )}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-[color:var(--text-0)]">
                      {item.name}
                    </p>
                    <p className="truncate font-mono text-[11px] text-[color:var(--text-2)]">
                      {item.id}.css
                    </p>
                  </div>
                  {isActive && <div className="h-2 w-2 rounded-full bg-[color:var(--accent)]" />}
                </button>
              );
            })
          )}

          {themes.length > 0 && themesPath && (
            <button
              onClick={() => void handleRevealThemes()}
              className="mt-1 flex items-center gap-1.5 self-start text-xs text-[color:var(--text-2)] transition-colors hover:text-[color:var(--text-1)]"
            >
              <FolderOpen className="h-3.5 w-3.5" />
              {t("settings.appearanceTab.revealFolder")}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
