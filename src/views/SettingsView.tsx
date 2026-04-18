import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { clsx } from "clsx";
import { getInferenceProviderConfig } from "../lib/tauri";
import type { InferenceProviderConfig } from "../lib/types";
import { GeneralTab } from "../components/settings/tabs/GeneralTab";
import { AppearanceTab } from "../components/settings/tabs/AppearanceTab";
import { LocalLLMTab } from "../components/settings/tabs/LocalLLMTab";
import { CloudLLMTab } from "../components/settings/tabs/CloudLLMTab";

type SettingsTab = "general" | "appearance" | "localLLM" | "cloudLLM";

export function SettingsView() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const [providerConfig, setProviderConfig] = useState<InferenceProviderConfig | null>(null);

  useEffect(() => {
    getInferenceProviderConfig()
      .then((cfg) => setProviderConfig(cfg))
      .catch(() => {});
  }, []);

  const tabs: { id: SettingsTab; label: string }[] = [
    { id: "general",    label: t("settings.tabs.general")    },
    { id: "appearance", label: t("settings.tabs.appearance") },
    { id: "localLLM",   label: t("settings.tabs.localLLM")   },
    { id: "cloudLLM",   label: t("settings.tabs.cloudLLM")   },
  ];

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Tab bar */}
      <div className="shrink-0 border-b border-[color:var(--border)] bg-[color:var(--bg-0)] px-8">
        <div className="mx-auto max-w-2xl">
          <div className="flex gap-1 pt-6 pb-0">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={clsx(
                  "relative px-4 py-2.5 text-sm font-medium transition-colors",
                  activeTab === tab.id
                    ? "text-[color:var(--text-0)]"
                    : "text-[color:var(--text-2)] hover:text-[color:var(--text-1)]",
                )}
              >
                {tab.label}
                {activeTab === tab.id && (
                  <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-t-full bg-[color:var(--accent)]" />
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-8">
        <div className="mx-auto max-w-2xl">
          {activeTab === "general" && <GeneralTab />}
          {activeTab === "appearance" && <AppearanceTab />}
          {activeTab === "localLLM" && (
            <LocalLLMTab
              config={providerConfig}
              onSaved={(cfg) => setProviderConfig(cfg)}
            />
          )}
          {activeTab === "cloudLLM" && (
            <CloudLLMTab
              config={providerConfig}
              onSaved={(cfg) => setProviderConfig(cfg)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
