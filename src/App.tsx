import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { BrowserRouter, Routes, Route, useNavigate } from "react-router-dom";
import { Sidebar } from "./components/layout/Sidebar";
import { useFileWatcher } from "./hooks/useFileWatcher";
import { useContextEvents } from "./hooks/useContextEvents";
import { useAppStore } from "./lib/store";
import { isOnboarded } from "./lib/tauri";
import { HealthBadge } from "./components/layout/HealthBadge";
import { useThemeEffect } from "./lib/settingsStore";
import { useVaultStore } from "./lib/vaultStore";
import { VaultConfirmDialog } from "./components/vault/VaultConfirmDialog";
import { VaultSwitchScreen } from "./components/vault/VaultSwitchScreen";
import { PanelLeft } from "lucide-react";

const ExplorerView = lazy(() =>
  import("./views/ExplorerView").then((module) => ({ default: module.ExplorerView })),
);
const GraphViewPage = lazy(() =>
  import("./views/GraphViewPage").then((module) => ({ default: module.GraphViewPage })),
);
const SimulationView = lazy(() =>
  import("./views/SimulationView").then((module) => ({ default: module.SimulationView })),
);
const GovernanceView = lazy(() =>
  import("./views/GovernanceView").then((module) => ({ default: module.GovernanceView })),
);
const JournalView = lazy(() =>
  import("./views/JournalView").then((module) => ({ default: module.JournalView })),
);
const TaskView = lazy(() =>
  import("./views/TaskView").then((module) => ({ default: module.TaskView })),
);
const OnboardingWizard = lazy(() =>
  import("./components/onboarding/OnboardingWizard").then((module) => ({
    default: module.OnboardingWizard,
  })),
);
const ObservabilityView = lazy(() =>
  import("./views/ObservabilityView").then((module) => ({
    default: module.ObservabilityView,
  })),
);
const SettingsView = lazy(() =>
  import("./views/SettingsView").then((module) => ({ default: module.SettingsView })),
);
const ConnectorsView = lazy(() =>
  import("./views/ConnectorsView").then((module) => ({ default: module.ConnectorsView })),
);
const SearchModal = lazy(() =>
  import("./components/layout/SearchModal").then((module) => ({
    default: module.SearchModal,
  })),
);

const appWindow = getCurrentWindow();

function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;

  if (target.isContentEditable) return true;

  const tagName = target.tagName.toLowerCase();
  if (tagName === "input" || tagName === "textarea" || tagName === "select") {
    return true;
  }

  return Boolean(target.closest("[contenteditable='true']"));
}

function isTitlebarInteractiveElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;

  return Boolean(
    target.closest(
      "button, a, input, textarea, select, [role='button'], [contenteditable='true']",
    ),
  );
}

function AppContent() {
  useFileWatcher();
  useContextEvents();
  useThemeEffect();
  const error = useAppStore((s) => s.error);
  const setError = useAppStore((s) => s.setError);
  const initialize = useAppStore((s) => s.initialize);
  const toggleExplorer = useAppStore((s) => s.toggleExplorer);
  const explorerOpen = useAppStore((s) => s.explorerOpen);
  const setExplorerOpen = useAppStore((s) => s.setExplorerOpen);

  const navigate = useNavigate();
  const [onboarded, setOnboarded] = useState<boolean | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [showOnboardingForVault, setShowOnboardingForVault] = useState(false);
  const titlebarRef = useRef<HTMLDivElement>(null);
  const { switchPhase, setActiveVaultPath, loadVaults } = useVaultStore();

  // Responsive: auto-close explorer on narrow windows
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    const handler = (e: MediaQueryListEvent | MediaQueryList) => {
      if (e.matches) setExplorerOpen(false);
    };
    handler(mq); // initial check
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [setExplorerOpen]);

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (isEditableElement(e.target)) return;
      switch (e.key.toLowerCase()) {
        case "k":
          e.preventDefault();
          setSearchOpen((v) => !v);
          break;
        case "g":
          e.preventDefault();
          navigate("/graph");
          break;
        case "j":
          e.preventDefault();
          navigate("/journal");
          break;
        case "b":
          e.preventDefault();
          toggleExplorer();
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [navigate, toggleExplorer]);

  useEffect(() => {
    isOnboarded()
      .then(setOnboarded)
      .catch(() => setOnboarded(false));
  }, []);

  // Sync active vault path on boot (after app has initialized)
  useEffect(() => {
    if (onboarded) {
      void loadVaults().then(() => {
        const { vaults } = useVaultStore.getState();
        // Best-effort: pick the first vault if none persisted yet
        if (!useVaultStore.getState().activeVaultPath && vaults.length > 0) {
          setActiveVaultPath(vaults[0].path);
        }
      });
    }
  }, [onboarded, loadVaults, setActiveVaultPath]);

  // Native DOM listener for window dragging — bypasses React's synthetic event system
  // which can interfere with macOS native drag handling
  useEffect(() => {
    const el = titlebarRef.current;
    if (!el) return;

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      if (isTitlebarInteractiveElement(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      appWindow.startDragging();
    };

    el.addEventListener("mousedown", onMouseDown);
    return () => el.removeEventListener("mousedown", onMouseDown);
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
      <Suspense fallback={<FullscreenSpinner />}>
        <OnboardingWizard
          onComplete={() => {
            setOnboarded(true);
            initialize();
          }}
        />
      </Suspense>
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[color:var(--bg-0)]">
      <div 
        ref={titlebarRef}
        data-tauri-drag-region
        className="flex h-[38px] w-full shrink-0 flex-row items-center border-b border-[color:var(--border)] relative z-50 bg-[color:var(--bg-0)]"
      >
        <div data-tauri-drag-region className="w-[72px] h-full shrink-0" /> {/* Spacer for macOS traffic lights */}

        {/* Animated spacer linking Toggle Button to the right edge of Explorer */}
        <div 
          data-tauri-drag-region
          className="flex h-full items-center justify-start overflow-hidden transition-[width] duration-300 ease-in-out"
          style={{ width: explorerOpen ? "196px" : "0px" }}
        />

        {/* Sliding Toggle Button: Pushed left/right by the animated spacer. 
            mb-[3px] perfectly nudges it upwards to counter optical misalignment with macOS traffic lights 
        */}
        <div data-tauri-drag-region className="flex w-[40px] items-center justify-center shrink-0 mb-[3px]">
          <button
            onClick={toggleExplorer}
            className="flex h-6 w-6 items-center justify-center rounded-md text-[color:var(--text-2)] transition-colors hover:bg-[color:var(--bg-2)] hover:text-[color:var(--text-1)]"
            title="Toggle Explorer"
          >
            <PanelLeft className="h-[15px] w-[15px]" pointerEvents="none" />
          </button>
        </div>

        {/* Health badge */}
        <div data-tauri-drag-region className="flex items-center pr-3">
          <HealthBadge />
        </div>

        {/* Remaining top window drag region */}
        <div data-tauri-drag-region className="flex-1 h-full" />
      </div>

      <div className="obs-app-shell flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="relative flex-1 overflow-hidden">
          <div className="h-full overflow-hidden bg-[color:var(--bg-1)]">
            <Suspense fallback={<RouteFallback />}>
              <Routes>
                <Route path="/" element={<ExplorerView />} />
                <Route path="/journal" element={<JournalView />} />
                <Route path="/tasks" element={<TaskView />} />
                <Route path="/graph" element={<GraphViewPage />} />
                <Route path="/simulation" element={<SimulationView />} />
                <Route path="/governance" element={<GovernanceView />} />
                <Route path="/observability" element={<ObservabilityView />} />
                <Route path="/connectors" element={<ConnectorsView />} />
                <Route path="/settings" element={<SettingsView />} />
              </Routes>
            </Suspense>
          </div>
          <Toast message={error} onDismiss={() => setError(null)} />
        </main>
      </div>
      <Suspense fallback={null}>
        <SearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />
      </Suspense>
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

function Toast({ message, onDismiss }: { message: string | null; onDismiss: () => void }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (message) {
      setVisible(true);
      const timer = setTimeout(() => {
        setVisible(false);
        setTimeout(onDismiss, 300);
      }, 4000);
      return () => clearTimeout(timer);
    } else {
      setVisible(false);
    }
  }, [message, onDismiss]);

  if (!message) return null;

  return (
    <div
      className={`absolute bottom-4 right-4 max-w-sm rounded-md border border-[color:var(--danger)]/30 bg-[color:var(--bg-2)] px-3 py-2.5 shadow-lg transition-all duration-300 ${visible ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"}`}
    >
      <div className="flex items-start gap-2">
        <p className="flex-1 text-xs text-[color:var(--text-1)]">{message}</p>
        <button
          onClick={() => { setVisible(false); setTimeout(onDismiss, 300); }}
          className="text-[color:var(--text-2)] hover:text-[color:var(--text-0)]"
        >
          ×
        </button>
      </div>
    </div>
  );
}

function FullscreenSpinner() {
  return (
    <div className="flex h-screen items-center justify-center text-[color:var(--text-2)]">
      <div className="h-4 w-4 animate-spin rounded-full border-2 border-[color:var(--text-2)] border-t-transparent" />
    </div>
  );
}

function RouteFallback() {
  return (
    <div className="flex h-full items-center justify-center text-[color:var(--text-2)]">
      <div className="h-4 w-4 animate-spin rounded-full border-2 border-[color:var(--text-2)] border-t-transparent" />
    </div>
  );
}

export default App;
