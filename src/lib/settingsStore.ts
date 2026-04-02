import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useEffect } from "react";

export type Theme = "dark" | "light" | "system";

export interface SettingsStore {
  theme: Theme;
  showSystemFiles: boolean;
  setTheme: (theme: Theme) => void;
  setShowSystemFiles: (show: boolean) => void;
  toggleShowSystemFiles: () => void;
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      theme: "system",
      showSystemFiles: false,
      setTheme: (theme) => set({ theme }),
      setShowSystemFiles: (showSystemFiles) => set({ showSystemFiles }),
      toggleShowSystemFiles: () =>
        set((state) => ({ showSystemFiles: !state.showSystemFiles })),
    }),
    {
      name: "obs-settings",
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
