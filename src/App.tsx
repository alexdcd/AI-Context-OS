import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Sidebar } from "./components/layout/Sidebar";
import { ExplorerView } from "./views/ExplorerView";
import { GraphViewPage } from "./views/GraphViewPage";
import { SimulationView } from "./views/SimulationView";
import { GovernanceView } from "./views/GovernanceView";
import { JournalView } from "./views/JournalView";
import { TaskView } from "./views/TaskView";
import { OnboardingWizard } from "./components/onboarding/OnboardingWizard";
import { useFileWatcher } from "./hooks/useFileWatcher";
import { useAppStore } from "./lib/store";
import { isOnboarded } from "./lib/tauri";
import { SettingsView } from "./views/SettingsView";
import { useThemeEffect } from "./lib/settingsStore";
import { PanelLeft } from "lucide-react";

function AppContent() {
  useFileWatcher();
  useThemeEffect();
  const error = useAppStore((s) => s.error);
  const setError = useAppStore((s) => s.setError);
  const initialize = useAppStore((s) => s.initialize);
  const toggleExplorer = useAppStore((s) => s.toggleExplorer);
  const explorerOpen = useAppStore((s) => s.explorerOpen);

  const [onboarded, setOnboarded] = useState<boolean | null>(null);

  useEffect(() => {
    isOnboarded()
      .then(setOnboarded)
      .catch(() => setOnboarded(false));
  }, []);

  if (onboarded === null) {
    return (
      <div className="flex h-screen items-center justify-center text-[color:var(--text-2)]">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-[color:var(--text-2)] border-t-transparent" />
      </div>
    );
  }

  if (!onboarded) {
    return (
      <OnboardingWizard
        onComplete={() => {
          setOnboarded(true);
          initialize();
        }}
      />
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[color:var(--bg-0)]">
      <div 
        className="flex h-[38px] w-full shrink-0 flex-row items-center border-b border-[color:var(--border)] relative z-50 bg-[color:var(--bg-0)]"
      >
        <div data-tauri-drag-region className="w-[72px] h-full shrink-0" /> {/* Spacer for macOS traffic lights */}

        {/* Animated spacer linking Toggle Button to the right edge of Explorer */}
        <div 
          className="flex h-full items-center justify-start overflow-hidden transition-[width] duration-300 ease-in-out"
          style={{ width: explorerOpen ? "196px" : "0px" }}
          data-tauri-drag-region
        />

        {/* Sliding Toggle Button: Pushed left/right by the animated spacer. 
            mb-[3px] perfectly nudges it upwards to counter optical misalignment with macOS traffic lights 
        */}
        <div className="flex w-[40px] items-center justify-center shrink-0 mb-[3px]">
          <button
            onClick={toggleExplorer}
            className="flex h-6 w-6 items-center justify-center rounded-md text-[color:var(--text-2)] transition-colors hover:bg-[color:var(--bg-2)] hover:text-[color:var(--text-1)]"
            title="Toggle Explorer"
          >
            <PanelLeft className="h-[15px] w-[15px]" pointerEvents="none" />
          </button>
        </div>

        {/* Remaining top window drag region */}
        <div data-tauri-drag-region className="flex-1 h-full" />
      </div>

      <div className="obs-app-shell flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="relative flex-1 overflow-hidden">
          <div className="h-full overflow-hidden bg-[color:var(--bg-1)]">
            <Routes>
              <Route path="/" element={<ExplorerView />} />
              <Route path="/journal" element={<JournalView />} />
              <Route path="/tasks" element={<TaskView />} />
              <Route path="/graph" element={<GraphViewPage />} />
              <Route path="/simulation" element={<SimulationView />} />
              <Route path="/governance" element={<GovernanceView />} />
              <Route path="/settings" element={<SettingsView />} />
            </Routes>
          </div>
          {error && (
            <div className="absolute bottom-4 right-4 max-w-sm rounded-md border border-[color:var(--danger)]/30 bg-[color:var(--bg-2)] px-3 py-2.5 shadow-lg">
              <div className="flex items-start gap-2">
                <p className="flex-1 text-xs text-[color:var(--text-1)]">{error}</p>
                <button
                  onClick={() => setError(null)}
                  className="text-[color:var(--text-2)] hover:text-[color:var(--text-0)]"
                >
                  ×
                </button>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  );
}

export default App;
