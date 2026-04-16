import { useState, useCallback, useEffect } from "react";
import { useSettingsStore, Theme } from "../lib/settingsStore";
import { Monitor, Moon, Sun, Download, Upload, Check, Loader2, Eye, EyeOff, Sparkles, PlugZap, Search, Zap, ChevronDown } from "lucide-react";
import { clsx } from "clsx";
import {
  backupWorkspace,
  discoverLocalProviders,
  getInferenceProviderConfig,
  getInferenceProviderStatus,
  listProviderModels,
  restoreWorkspace,
  saveInferenceProviderConfig,
  testInferenceProvider,
} from "../lib/tauri";
import { save, open } from "@tauri-apps/plugin-dialog";
import { useAppStore } from "../lib/store";
import { useTranslation } from "react-i18next";
import { type Language } from "../lib/settingsStore";
import { VaultSettingsSection } from "../components/vault/VaultSettingsSection";
import { UpdateSection } from "../components/settings/UpdateSection";
import type {
  DiscoveredProvider,
  InferenceProviderConfig,
  InferenceProviderKind,
  InferenceProviderPreset,
  InferenceProviderStatus,
  ProviderModel,
} from "../lib/types";

export function SettingsView() {
  const { t } = useTranslation();
  // Access showOnboardingForVault trigger via window event — avoids prop drilling
  const handleCreateNew = () =>
    window.dispatchEvent(new CustomEvent("vault:create-new"));
  const language = useSettingsStore((s) => s.language);
  const setLanguage = useSettingsStore((s) => s.setLanguage);
  const theme = useSettingsStore((s) => s.theme);
  const expertModeEnabled = useSettingsStore((s) => s.expertModeEnabled);
  const showSystemFiles = useSettingsStore((s) => s.showSystemFiles);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const setExpertModeEnabled = useSettingsStore((s) => s.setExpertModeEnabled);
  const setShowSystemFiles = useSettingsStore((s) => s.setShowSystemFiles);
  const initialize = useAppStore((s) => s.initialize);

  const [backupStatus, setBackupStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [restoreStatus, setRestoreStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [providerConfig, setProviderConfig] = useState<InferenceProviderConfig>({
    enabled: false,
    kind: "openai_compatible",
    preset: "ollama",
    model: "",
    base_url: "http://127.0.0.1:11434/v1",
    api_key: "",
    capabilities: ["proposal", "classification", "summary", "chat", "streaming"],
  });
  const [providerStatus, setProviderStatus] = useState<InferenceProviderStatus | null>(null);
  const [providerBusy, setProviderBusy] = useState<"idle" | "saving" | "testing" | "discovering" | "loading_models">("idle");
  const [discoveredProviders, setDiscoveredProviders] = useState<DiscoveredProvider[]>([]);
  const [availableModels, setAvailableModels] = useState<ProviderModel[]>([]);

  useEffect(() => {
    void (async () => {
      try {
        const savedConfig = await getInferenceProviderConfig();
        if (savedConfig) {
          setProviderConfig({
            ...savedConfig,
            api_key: savedConfig.api_key ?? "",
            base_url: savedConfig.base_url ?? "",
          });
          // Auto-load model list for local providers
          if (
            savedConfig.preset === "ollama" ||
            savedConfig.preset === "lm_studio"
          ) {
            listProviderModels(savedConfig)
              .then((models) => setAvailableModels(models))
              .catch(() => {});
          }
        }
        const savedStatus = await getInferenceProviderStatus();
        setProviderStatus(savedStatus);
      } catch (error) {
        console.error("Failed to load inference settings", error);
        setProviderStatus({
          configured: false,
          enabled: false,
          healthy: false,
          kind: null,
          preset: null,
          base_url: null,
          model: null,
          capabilities: [],
          message: `Load error: ${String(error)}`,
        });
      }
    })();
  }, []);

  const handleBackup = useCallback(async () => {
    const dest = await save({
      defaultPath: `ai-context-os-backup-${new Date().toISOString().slice(0, 10)}.zip`,
      filters: [{ name: "Zip", extensions: ["zip"] }],
    });
    if (!dest) return;
    setBackupStatus("loading");
    try {
      await backupWorkspace(dest);
      setBackupStatus("done");
      setTimeout(() => setBackupStatus("idle"), 2000);
    } catch {
      setBackupStatus("error");
      setTimeout(() => setBackupStatus("idle"), 3000);
    }
  }, []);

  const handleRestore = useCallback(async () => {
    const result = await open({
      filters: [{ name: "Zip", extensions: ["zip"] }],
      multiple: false,
    });
    if (!result) return;
    const ok = window.confirm(t("settings.backup.restoreConfirm"));
    if (!ok) return;
    setRestoreStatus("loading");
    try {
      await restoreWorkspace(result);
      setRestoreStatus("done");
      initialize();
      setTimeout(() => setRestoreStatus("idle"), 2000);
    } catch {
      setRestoreStatus("error");
      setTimeout(() => setRestoreStatus("idle"), 3000);
    }
  }, [initialize, t]);

  const themeOptions: { value: Theme; label: string; icon: typeof Monitor; describe: string }[] = [
    { value: "system", label: t("settings.theme.system"), icon: Monitor, describe: t("settings.theme.systemDesc") },
    { value: "light",  label: t("settings.theme.light"),  icon: Sun,     describe: t("settings.theme.lightDesc") },
    { value: "dark",   label: t("settings.theme.dark"),   icon: Moon,    describe: t("settings.theme.darkDesc") },
  ];

  const applyPresetDefaults = useCallback(
    (kind: InferenceProviderKind, preset: InferenceProviderPreset) => {
      const defaults: Record<InferenceProviderPreset, { base_url: string; requiresKey: boolean }> = {
        custom: { base_url: "", requiresKey: false },
        openai: { base_url: "https://api.openai.com/v1", requiresKey: true },
        openrouter: { base_url: "https://openrouter.ai/api/v1", requiresKey: true },
        ollama: { base_url: "http://127.0.0.1:11434/v1", requiresKey: false },
        lm_studio: { base_url: "http://127.0.0.1:1234/v1", requiresKey: false },
      };
      const nextDefault = defaults[preset];
      setProviderConfig((current) => ({
        ...current,
        kind,
        preset,
        base_url: current.base_url?.trim() ? current.base_url : nextDefault.base_url,
        api_key: nextDefault.requiresKey ? current.api_key ?? "" : current.api_key ?? "",
      }));
    },
    [],
  );

  const handleSaveProvider = useCallback(async () => {
    setProviderBusy("saving");
    try {
      const configToSave = {
        ...providerConfig,
        base_url: providerConfig.base_url?.trim() || null,
        api_key: providerConfig.api_key?.trim() || null,
      };
      const saved = await saveInferenceProviderConfig(configToSave);
      setProviderConfig({
        ...saved,
        base_url: saved.base_url ?? "",
        api_key: saved.api_key ?? "",
      });
      // Show saved status immediately
      setProviderStatus({
        configured: true,
        enabled: saved.enabled,
        healthy: false,
        kind: saved.kind,
        preset: saved.preset,
        base_url: saved.base_url ?? null,
        model: saved.model || null,
        capabilities: saved.capabilities,
        message: "Configuration saved. Testing connection...",
      });
      // Then test (don't block save feedback on test result)
      if (saved.enabled) {
        setProviderBusy("testing");
        try {
          const status = await testInferenceProvider(saved);
          setProviderStatus(status);
        } catch (error) {
          setProviderStatus({
            configured: true,
            enabled: saved.enabled,
            healthy: false,
            kind: saved.kind,
            preset: saved.preset,
            base_url: saved.base_url ?? null,
            model: saved.model || null,
            capabilities: saved.capabilities,
            message: `Saved but test failed: ${String(error)}`,
          });
        }
      }
    } catch (error) {
      setProviderStatus((prev) => ({
        configured: false,
        enabled: false,
        healthy: false,
        kind: providerConfig.kind,
        preset: providerConfig.preset,
        base_url: providerConfig.base_url ?? null,
        model: providerConfig.model || null,
        capabilities: prev?.capabilities ?? [],
        message: `Save failed: ${String(error)}`,
      }));
    } finally {
      setProviderBusy("idle");
    }
  }, [providerConfig]);

  const handleTestProvider = useCallback(async () => {
    setProviderBusy("testing");
    try {
      const status = await testInferenceProvider({
        ...providerConfig,
        base_url: providerConfig.base_url?.trim() || null,
        api_key: providerConfig.api_key?.trim() || null,
      });
      setProviderStatus(status);
    } catch (error) {
      setProviderStatus({
        configured: true,
        enabled: providerConfig.enabled,
        healthy: false,
        kind: providerConfig.kind,
        preset: providerConfig.preset,
        base_url: providerConfig.base_url ?? null,
        model: providerConfig.model || null,
        capabilities: providerConfig.capabilities,
        message: String(error),
      });
    } finally {
      setProviderBusy("idle");
    }
  }, [providerConfig]);

  const handleDiscover = useCallback(async () => {
    setProviderBusy("discovering");
    try {
      const providers = await discoverLocalProviders();
      setDiscoveredProviders(providers);
      // Auto-connect to first reachable provider if none is configured yet
      const reachable = providers.find((p) => p.reachable && p.models.length > 0);
      if (reachable && !providerConfig.model) {
        setProviderConfig((current) => ({
          ...current,
          kind: "openai_compatible" as InferenceProviderKind,
          preset: reachable.preset,
          base_url: reachable.base_url,
          model: reachable.models[0]?.id ?? "",
          enabled: true,
        }));
        setAvailableModels(reachable.models);
      }
    } catch (error) {
      console.error("Discovery failed", error);
    } finally {
      setProviderBusy("idle");
    }
  }, [providerConfig.model]);

  const handleConnectProvider = useCallback(async (provider: DiscoveredProvider) => {
    const newConfig: InferenceProviderConfig = {
      enabled: true,
      kind: "openai_compatible",
      preset: provider.preset,
      model: provider.models[0]?.id ?? "",
      base_url: provider.base_url,
      api_key: null,
      capabilities: ["proposal", "classification", "summary", "chat", "streaming"],
    };
    setProviderConfig({ ...newConfig, api_key: "", base_url: newConfig.base_url ?? "" });
    setAvailableModels(provider.models);

    // Save
    setProviderBusy("saving");
    try {
      const saved = await saveInferenceProviderConfig(newConfig);
      setProviderConfig({
        ...saved,
        base_url: saved.base_url ?? "",
        api_key: saved.api_key ?? "",
      });
      setProviderStatus({
        configured: true,
        enabled: true,
        healthy: false,
        kind: saved.kind,
        preset: saved.preset,
        base_url: saved.base_url ?? null,
        model: saved.model || null,
        capabilities: saved.capabilities,
        message: `${provider.name} configured with ${provider.models.length} models. Testing...`,
      });
    } catch (error) {
      setProviderStatus({
        configured: false, enabled: false, healthy: false,
        kind: "openai_compatible", preset: provider.preset,
        base_url: provider.base_url, model: null, capabilities: [],
        message: `Save failed: ${String(error)}`,
      });
      setProviderBusy("idle");
      return;
    }

    // Test (separate step, failure doesn't undo save)
    setProviderBusy("testing");
    try {
      const status = await testInferenceProvider();
      setProviderStatus(status);
    } catch (error) {
      setProviderStatus({
        configured: true,
        enabled: true,
        healthy: false,
        kind: "openai_compatible",
        preset: provider.preset,
        base_url: provider.base_url,
        model: provider.models[0]?.id ?? null,
        capabilities: newConfig.capabilities,
        message: `Saved OK, but connection test failed: ${String(error)}`,
      });
    } finally {
      setProviderBusy("idle");
    }
  }, []);

  const handleLoadModels = useCallback(async () => {
    setProviderBusy("loading_models");
    try {
      const models = await listProviderModels({
        ...providerConfig,
        base_url: providerConfig.base_url?.trim() || null,
        api_key: providerConfig.api_key?.trim() || null,
      });
      setAvailableModels(models);
    } catch (error) {
      console.error("Failed to list models", error);
      setAvailableModels([]);
    } finally {
      setProviderBusy("idle");
    }
  }, [providerConfig]);

  return (
    <div className="h-full overflow-y-auto p-8">
      <div className="mx-auto max-w-2xl space-y-6">
        <h1 className="mb-8 text-2xl font-semibold text-[color:var(--text-0)]">{t("settings.title")}</h1>

        {/* Workspace / Vault section */}
        <VaultSettingsSection onCreateNew={handleCreateNew} />

        {/* Appearance */}
        <section className="obs-panel border border-[color:var(--border)] p-6">
          <h2 className="mb-4 text-lg font-medium text-[color:var(--text-0)]">{t("settings.appearance")}</h2>

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
                      : "border-[color:var(--border)] bg-[color:var(--bg-0)] hover:border-[color:var(--border-active)]"
                  )}
                >
                  <div className="flex w-full items-center justify-between">
                    <div className="flex items-center gap-3">
                      <option.icon
                        className={clsx(
                          "h-5 w-5",
                          isActive ? "text-[color:var(--accent)]" : "text-[color:var(--text-1)]"
                        )}
                      />
                      <span
                        className={clsx(
                          "font-medium",
                          isActive ? "text-[color:var(--text-0)]" : "text-[color:var(--text-1)]"
                        )}
                      >
                        {option.label}
                      </span>
                    </div>
                    {isActive && (
                      <div className="h-2 w-2 rounded-full bg-[color:var(--accent)]" />
                    )}
                  </div>
                  <p className="mt-2 text-sm text-[color:var(--text-2)]">{option.describe}</p>
                </button>
              );
            })}
          </div>
        </section>

        {/* Language */}
        <section className="obs-panel border border-[color:var(--border)] p-6">
          <h2 className="mb-4 text-lg font-medium text-[color:var(--text-0)]">
            {t("settings.language.label")}
          </h2>
          <div className="flex gap-2">
            {(["en", "es"] as Language[]).map((lang) => (
              <button
                key={lang}
                onClick={() => setLanguage(lang)}
                className={clsx(
                  "rounded-md border px-4 py-1.5 text-sm font-medium transition-colors",
                  language === lang
                    ? "border-[color:var(--accent)] bg-[color:var(--accent-muted)] text-[color:var(--accent)]"
                    : "border-[var(--border)] bg-[color:var(--bg-2)] text-[color:var(--text-1)] hover:border-[var(--border-active)]",
                )}
              >
                {t(`settings.language.${lang}` as const)}
              </button>
            ))}
          </div>
        </section>

        <section className="obs-panel border border-[color:var(--border)] p-6">
          <h2 className="mb-1 text-lg font-medium text-[color:var(--text-0)]">{t("settings.explorer.label")}</h2>
          <p className="mb-4 text-sm text-[color:var(--text-2)]">
            {t("settings.explorer.expertModeDesc")}
          </p>

          <button
            onClick={() => setExpertModeEnabled(!expertModeEnabled)}
            className={clsx(
              "flex w-full items-start gap-3 rounded-md border p-4 text-left transition-colors",
              expertModeEnabled
                ? "border-[color:var(--accent)] bg-[color:var(--accent-muted)]"
                : "border-[color:var(--border)] bg-[color:var(--bg-0)] hover:border-[color:var(--border-active)]"
            )}
          >
            <div className="flex-1">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-medium text-[color:var(--text-0)]">{t("settings.explorer.expertMode")}</div>
                  <p className="mt-2 text-sm text-[color:var(--text-2)]">
                    {expertModeEnabled
                      ? t("settings.explorer.expertModeActive")
                      : t("settings.explorer.showSystemFilesDesc")}
                  </p>
                </div>
                <span
                  className={clsx(
                    "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
                    expertModeEnabled ? "bg-[color:var(--accent)]" : "bg-[color:var(--bg-3)]"
                  )}
                >
                  <span
                    className={clsx(
                      "inline-block h-4 w-4 rounded-full bg-white transition-transform",
                      expertModeEnabled ? "translate-x-6" : "translate-x-1"
                    )}
                  />
                </span>
              </div>
            </div>
          </button>

          {expertModeEnabled && (
            <button
              onClick={() => setShowSystemFiles(!showSystemFiles)}
              className={clsx(
                "mt-3 flex w-full items-start gap-3 rounded-md border p-4 text-left transition-colors",
                showSystemFiles
                  ? "border-[color:var(--accent)] bg-[color:var(--accent-muted)]"
                  : "border-[color:var(--border)] bg-[color:var(--bg-0)] hover:border-[color:var(--border-active)]"
              )}
            >
              <div className="mt-0.5">
                {showSystemFiles ? (
                  <Eye className="h-5 w-5 text-[color:var(--accent)]" />
                ) : (
                  <EyeOff className="h-5 w-5 text-[color:var(--text-2)]" />
                )}
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-[color:var(--text-0)]">{t("settings.explorer.showSystemFiles")}</span>
                  <span
                    className={clsx(
                      "rounded-full px-2 py-0.5 text-[11px] font-medium",
                      showSystemFiles
                        ? "bg-[color:var(--accent)] text-white"
                        : "bg-[color:var(--bg-2)] text-[color:var(--text-2)]"
                    )}
                  >
                    {showSystemFiles ? t("settings.explorer.showSystemFilesActive") : t("settings.explorer.showSystemFilesHidden")}
                  </span>
                </div>
                <p className="mt-2 text-sm text-[color:var(--text-2)]">
                  {showSystemFiles
                    ? t("settings.explorer.showSystemFilesVisible")
                    : t("settings.explorer.showSystemFilesHiddenDesc")}
                </p>
              </div>
            </button>
          )}
        </section>

        <section className="obs-panel border border-[color:var(--border)] p-6">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-medium text-[color:var(--text-0)]">{t("settings.inference.title")}</h2>
              <p className="mt-1 text-sm text-[color:var(--text-2)]">{t("settings.inference.desc")}</p>
            </div>
            <div className="rounded-full bg-[color:var(--bg-2)] px-3 py-1 text-[11px] font-medium text-[color:var(--text-1)]">
              {providerStatus?.healthy ? t("settings.inference.healthy") : t("settings.inference.optional")}
            </div>
          </div>

          {/* Auto-detect local providers */}
          <div className="mb-4">
            <button
              onClick={() => void handleDiscover()}
              disabled={providerBusy !== "idle"}
              className="flex items-center gap-2 rounded-md border border-dashed border-[color:var(--accent)] bg-[color:var(--accent-muted)] px-4 py-2.5 text-sm font-medium text-[color:var(--accent)] transition-colors hover:bg-[color:var(--accent)] hover:text-white disabled:opacity-60"
            >
              {providerBusy === "discovering" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
              {providerBusy === "discovering"
                ? t("settings.inference.discovering")
                : t("settings.inference.autoDetect")}
            </button>

            {discoveredProviders.length > 0 && (
              <div className="mt-3 flex flex-col gap-2">
                {discoveredProviders.map((provider) => (
                  <div
                    key={provider.preset}
                    className={clsx(
                      "flex items-center justify-between rounded-md border p-3 text-sm",
                      provider.reachable
                        ? "border-green-500/30 bg-green-500/5"
                        : "border-[color:var(--border)] bg-[color:var(--bg-0)] opacity-50",
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={clsx(
                          "h-2 w-2 rounded-full",
                          provider.reachable ? "bg-green-500" : "bg-[color:var(--text-2)]",
                        )}
                      />
                      <div>
                        <span className="font-medium text-[color:var(--text-0)]">{provider.name}</span>
                        {provider.reachable && (
                          <span className="ml-2 text-xs text-[color:var(--text-2)]">
                            {provider.models.length} {t("settings.inference.modelsAvailable")}
                          </span>
                        )}
                      </div>
                    </div>
                    {provider.reachable && (
                      <button
                        onClick={() => void handleConnectProvider(provider)}
                        disabled={providerBusy !== "idle"}
                        className="flex items-center gap-1.5 rounded-md bg-[color:var(--accent)] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:opacity-90 disabled:opacity-60"
                      >
                        {providerBusy !== "idle" && providerConfig.preset === provider.preset ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Zap className="h-3 w-3" />
                        )}
                        {providerBusy !== "idle" && providerConfig.preset === provider.preset
                          ? t("settings.inference.connecting")
                          : t("settings.inference.connect")}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium text-[color:var(--text-1)]">{t("settings.inference.provider")}</span>
              <select
                value={providerConfig.kind}
                onChange={(event) =>
                  applyPresetDefaults(event.target.value as InferenceProviderKind, providerConfig.preset)
                }
                className="rounded-md border border-[color:var(--border)] bg-[color:var(--bg-0)] px-3 py-2 text-sm text-[color:var(--text-0)]"
              >
                <option value="anthropic">Anthropic</option>
                <option value="openai_compatible">{t("settings.inference.openaiCompatible")}</option>
              </select>
            </label>

            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium text-[color:var(--text-1)]">{t("settings.inference.preset")}</span>
              <select
                value={providerConfig.preset}
                onChange={(event) =>
                  applyPresetDefaults(providerConfig.kind, event.target.value as InferenceProviderPreset)
                }
                className="rounded-md border border-[color:var(--border)] bg-[color:var(--bg-0)] px-3 py-2 text-sm text-[color:var(--text-0)]"
              >
                <option value="openai">OpenAI</option>
                <option value="openrouter">OpenRouter</option>
                <option value="ollama">Ollama</option>
                <option value="lm_studio">LM Studio</option>
                <option value="custom">{t("settings.inference.custom")}</option>
              </select>
            </label>

            {/* Model: dropdown if models loaded, otherwise input with load button */}
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium text-[color:var(--text-1)]">{t("settings.inference.model")}</span>
              <div className="relative flex gap-1">
                {availableModels.length > 0 ? (
                  <div className="relative flex-1">
                    <select
                      value={providerConfig.model}
                      onChange={(event) =>
                        setProviderConfig((current) => ({ ...current, model: event.target.value }))
                      }
                      className="w-full appearance-none rounded-md border border-[color:var(--border)] bg-[color:var(--bg-0)] px-3 py-2 pr-8 text-sm text-[color:var(--text-0)]"
                    >
                      {!availableModels.some((m) => m.id === providerConfig.model) && providerConfig.model && (
                        <option value={providerConfig.model}>{providerConfig.model}</option>
                      )}
                      {availableModels.map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.id}
                          {model.family ? ` (${model.family})` : ""}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-[color:var(--text-2)]" />
                  </div>
                ) : (
                  <input
                    value={providerConfig.model}
                    onChange={(event) =>
                      setProviderConfig((current) => ({ ...current, model: event.target.value }))
                    }
                    placeholder={t("settings.inference.modelPlaceholder")}
                    className="flex-1 rounded-md border border-[color:var(--border)] bg-[color:var(--bg-0)] px-3 py-2 text-sm text-[color:var(--text-0)]"
                  />
                )}
                <button
                  onClick={() => void handleLoadModels()}
                  disabled={providerBusy !== "idle"}
                  title={t("settings.inference.loadModels")}
                  className="shrink-0 rounded-md border border-[color:var(--border)] bg-[color:var(--bg-0)] px-2.5 py-2 text-[color:var(--text-1)] transition-colors hover:border-[color:var(--border-active)] disabled:opacity-60"
                >
                  {providerBusy === "loading_models" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Search className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium text-[color:var(--text-1)]">{t("settings.inference.endpoint")}</span>
              <input
                value={providerConfig.base_url ?? ""}
                onChange={(event) => setProviderConfig((current) => ({ ...current, base_url: event.target.value }))}
                placeholder="https://..."
                className="rounded-md border border-[color:var(--border)] bg-[color:var(--bg-0)] px-3 py-2 text-sm text-[color:var(--text-0)]"
              />
            </label>

            <label className="md:col-span-2 flex flex-col gap-2">
              <span className="text-sm font-medium text-[color:var(--text-1)]">{t("settings.inference.apiKey")}</span>
              <input
                value={providerConfig.api_key ?? ""}
                onChange={(event) => setProviderConfig((current) => ({ ...current, api_key: event.target.value }))}
                placeholder={t("settings.inference.apiKeyPlaceholder")}
                className="rounded-md border border-[color:var(--border)] bg-[color:var(--bg-0)] px-3 py-2 text-sm text-[color:var(--text-0)]"
              />
            </label>
          </div>

          <button
            onClick={() => setProviderConfig((current) => ({ ...current, enabled: !current.enabled }))}
            className={clsx(
              "mt-4 flex w-full items-start gap-3 rounded-md border p-4 text-left transition-colors",
              providerConfig.enabled
                ? "border-[color:var(--accent)] bg-[color:var(--accent-muted)]"
                : "border-[color:var(--border)] bg-[color:var(--bg-0)] hover:border-[color:var(--border-active)]",
            )}
          >
            <div className="mt-0.5">
              {providerConfig.enabled ? (
                <Sparkles className="h-5 w-5 text-[color:var(--accent)]" />
              ) : (
                <PlugZap className="h-5 w-5 text-[color:var(--text-2)]" />
              )}
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium text-[color:var(--text-0)]">{t("settings.inference.enable")}</span>
                <span
                  className={clsx(
                    "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
                    providerConfig.enabled ? "bg-[color:var(--accent)]" : "bg-[color:var(--bg-3)]",
                  )}
                >
                  <span
                    className={clsx(
                      "inline-block h-4 w-4 rounded-full bg-white transition-transform",
                      providerConfig.enabled ? "translate-x-6" : "translate-x-1",
                    )}
                  />
                </span>
              </div>
              <p className="mt-2 text-sm text-[color:var(--text-2)]">{providerStatus?.message ?? t("settings.inference.heuristicFallback")}</p>
            </div>
          </button>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              onClick={() => void handleSaveProvider()}
              disabled={providerBusy !== "idle"}
              className="inline-flex items-center gap-2 rounded-md bg-[color:var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              {providerBusy === "saving" && <Loader2 className="h-4 w-4 animate-spin" />}
              {providerBusy === "saving" ? t("settings.inference.saving") : t("settings.inference.save")}
            </button>
            <button
              onClick={() => void handleTestProvider()}
              disabled={providerBusy !== "idle"}
              className="inline-flex items-center gap-2 rounded-md border border-[color:var(--border)] bg-[color:var(--bg-0)] px-4 py-2 text-sm font-medium text-[color:var(--text-1)] disabled:opacity-60"
            >
              {providerBusy === "testing" && <Loader2 className="h-4 w-4 animate-spin" />}
              {providerBusy === "testing" ? t("settings.inference.testing") : t("settings.inference.test")}
            </button>

            {/* Connection result badge */}
            {providerBusy === "idle" && providerStatus?.configured && (
              <span
                className={clsx(
                  "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium",
                  providerStatus.healthy
                    ? "bg-green-500/10 text-green-600"
                    : "bg-red-500/10 text-red-500",
                )}
              >
                <span
                  className={clsx(
                    "h-1.5 w-1.5 rounded-full",
                    providerStatus.healthy ? "bg-green-500" : "bg-red-500",
                  )}
                />
                {providerStatus.healthy
                  ? t("settings.inference.connectionOk")
                  : t("settings.inference.connectionFailed")}
              </span>
            )}
          </div>

          {/* Show test result message */}
          {providerBusy === "idle" && providerStatus?.message && providerStatus.configured && (
            <p className={clsx(
              "mt-2 rounded-md px-3 py-2 text-xs",
              providerStatus.healthy
                ? "bg-green-500/5 text-green-600"
                : "bg-red-500/5 text-red-500",
            )}>
              {providerStatus.message}
            </p>
          )}
        </section>

        {/* Updates */}
        <UpdateSection />

        {/* Backup / Restore */}
        <section className="obs-panel border border-[color:var(--border)] p-6">
          <h2 className="mb-1 text-lg font-medium text-[color:var(--text-0)]">{t("settings.backup.title")}</h2>
          <p className="mb-4 text-sm text-[color:var(--text-2)]">
            {t("settings.backup.desc")}
          </p>

          <div className="flex flex-col gap-3">
            <button
              onClick={() => void handleBackup()}
              disabled={backupStatus === "loading"}
              className="flex items-center gap-3 rounded-md border border-[color:var(--border)] bg-[color:var(--bg-0)] p-4 text-left transition-colors hover:border-[color:var(--border-active)]"
            >
              {backupStatus === "loading" ? (
                <Loader2 className="h-5 w-5 animate-spin text-[color:var(--accent)]" />
              ) : backupStatus === "done" ? (
                <Check className="h-5 w-5 text-[color:var(--success)]" />
              ) : (
                <Download className="h-5 w-5 text-[color:var(--text-1)]" />
              )}
              <div>
                <span className="font-medium text-[color:var(--text-1)]">{t("settings.backup.export")}</span>
                <p className="mt-0.5 text-sm text-[color:var(--text-2)]">
                  {backupStatus === "done"
                    ? t("settings.backup.exportSuccess")
                    : backupStatus === "error"
                      ? t("settings.backup.exportError")
                      : t("settings.backup.exportDesc")}
                </p>
              </div>
            </button>

            <button
              onClick={() => void handleRestore()}
              disabled={restoreStatus === "loading"}
              className="flex items-center gap-3 rounded-md border border-[color:var(--border)] bg-[color:var(--bg-0)] p-4 text-left transition-colors hover:border-[color:var(--border-active)]"
            >
              {restoreStatus === "loading" ? (
                <Loader2 className="h-5 w-5 animate-spin text-[color:var(--accent)]" />
              ) : restoreStatus === "done" ? (
                <Check className="h-5 w-5 text-[color:var(--success)]" />
              ) : (
                <Upload className="h-5 w-5 text-[color:var(--text-1)]" />
              )}
              <div>
                <span className="font-medium text-[color:var(--text-1)]">{t("settings.backup.restore")}</span>
                <p className="mt-0.5 text-sm text-[color:var(--text-2)]">
                  {restoreStatus === "done"
                    ? t("settings.backup.restoreSuccess")
                    : restoreStatus === "error"
                      ? t("settings.backup.restoreError")
                      : t("settings.backup.restoreDesc")}
                </p>
              </div>
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
