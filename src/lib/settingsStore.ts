import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useEffect } from "react";
import { applyCustomThemeCss, clearCustomTheme, loadCustomThemeById } from "./themeLoader";
import { migrateSettingsStore } from "./settingsMigration";

export type Theme = "dark" | "light" | "system";
export type Language = "en" | "es";
export type AppearanceMode = "modern" | "classic";

export interface SettingsStore {
  theme: Theme;
  appearanceMode: AppearanceMode;
  showMarkdownSyntax: boolean;
  customThemeId: string | null;
  expertModeEnabled: boolean;
  showSystemFiles: boolean;
  language: Language;
  folderColors: Record<string, string>;
  setTheme: (theme: Theme) => void;
  setAppearanceMode: (mode: AppearanceMode) => void;
  setShowMarkdownSyntax: (show: boolean) => void;
  toggleShowMarkdownSyntax: () => void;
  setCustomThemeId: (id: string | null) => void;
  setExpertModeEnabled: (enabled: boolean) => void;
  toggleExpertModeEnabled: () => void;
  setShowSystemFiles: (show: boolean) => void;
  toggleShowSystemFiles: () => void;
  setLanguage: (lang: Language) => void;
  setFolderColor: (folderPath: string, color: string) => void;
  clearFolderColor: (folderPath: string) => void;
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      theme: "system",
      appearanceMode: "modern",
      showMarkdownSyntax: false,
      customThemeId: null,
      expertModeEnabled: false,
      showSystemFiles: false,
      language: "en",
      folderColors: {},
      setTheme: (theme) => set({ theme }),
      setAppearanceMode: (appearanceMode) => set({ appearanceMode }),
      setShowMarkdownSyntax: (showMarkdownSyntax) => set({ showMarkdownSyntax }),
      toggleShowMarkdownSyntax: () =>
        set((state) => ({ showMarkdownSyntax: !state.showMarkdownSyntax })),
      setCustomThemeId: (customThemeId) => set({ customThemeId }),
      setExpertModeEnabled: (expertModeEnabled) =>
        set((state) => ({
          expertModeEnabled,
          showSystemFiles: expertModeEnabled ? state.showSystemFiles : false,
        })),
      toggleExpertModeEnabled: () =>
        set((state) => {
          const nextEnabled = !state.expertModeEnabled;
          return {
            expertModeEnabled: nextEnabled,
            showSystemFiles: nextEnabled ? state.showSystemFiles : false,
          };
        }),
      setShowSystemFiles: (showSystemFiles) => set({ showSystemFiles }),
      toggleShowSystemFiles: () =>
        set((state) => ({ showSystemFiles: !state.showSystemFiles })),
      setLanguage: (language) => set({ language }),
      setFolderColor: (folderPath, color) =>
        set((state) => ({
          folderColors: { ...state.folderColors, [folderPath]: color },
        })),
      clearFolderColor: (folderPath) =>
        set((state) => {
          const { [folderPath]: _, ...rest } = state.folderColors;
          return { folderColors: rest };
        }),
    }),
    {
      name: "obs-settings",
      version: 1,
      migrate: migrateSettingsStore,
    }
  )
);

export function useThemeEffect() {
  const theme = useSettingsStore((s) => s.theme);

  useEffect(() => {
    const root = document.documentElement;

    const applyTheme = (isDark: boolean) => {
      if (isDark) {
        root.classList.add("dark");
        root.classList.remove("light");
      } else {
        root.classList.add("light");
        root.classList.remove("dark");
      }
    };

    if (theme === "system") {
      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      applyTheme(mediaQuery.matches);

      const listener = (e: MediaQueryListEvent) => applyTheme(e.matches);
      mediaQuery.addEventListener("change", listener);
      return () => mediaQuery.removeEventListener("change", listener);
    } else {
      applyTheme(theme === "dark");
    }
  }, [theme]);
}

export function useAppearanceEffect() {
  const appearanceMode = useSettingsStore((s) => s.appearanceMode);
  const customThemeId = useSettingsStore((s) => s.customThemeId);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", appearanceMode);
  }, [appearanceMode]);

  useEffect(() => {
    if (!customThemeId) {
      clearCustomTheme();
      return;
    }

    let cancelled = false;

    void loadCustomThemeById(customThemeId).then((result) => {
      if (cancelled) return;

      if (!result.ok) {
        clearCustomTheme();
        useSettingsStore.setState({ customThemeId: null });
        return;
      }

      applyCustomThemeCss(customThemeId, result.css);
    });

    return () => {
      cancelled = true;
    };
  }, [customThemeId]);
}
