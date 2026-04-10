// Nota: en una iteración posterior, mover tipos y lista de conectores a src/lib/connectors.ts
import { useEffect, useState, useMemo } from "react";
import { Copy, FileText, Check } from "lucide-react";
import { clsx } from "clsx";
import { useTranslation, Trans } from "react-i18next";
import { getMcpConnectionInfo, simulateContext, writeFile } from "../lib/tauri";
import type { McpConnectionInfo } from "../lib/types";

type IntegrationTier = "Local Native" | "Bridge";

interface ConnectorDef {
  id: string;
  name: string;
  tier: IntegrationTier;
  description: string;
  icon: string;
  capabilities: string[];
}

export function ConnectorsView() {
  const { t } = useTranslation();
  const [info, setInfo] = useState<McpConnectionInfo | null>(null);
  const [activeConnector, setActiveConnector] = useState<string>("claude-desktop");
  const [bridgeStatus, setBridgeStatus] = useState<"idle" | "loading" | "done">("idle");
  const [bridgeText, setBridgeText] = useState<string>("");
  const [bridgeFeedback, setBridgeFeedback] = useState<string>("");
  const [bridgeError, setBridgeError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const CONNECTORS: ConnectorDef[] = useMemo(() => [
    {
      id: "claude-desktop",
      name: t("connectors.list.claudeDesktop.name"),
      tier: "Local Native",
      description: t("connectors.list.claudeDesktop.description"),
      icon: "C",
      capabilities: [
        t("connectors.list.claudeDesktop.cap1"),
        t("connectors.list.claudeDesktop.cap2"),
        t("connectors.list.claudeDesktop.cap3"),
      ],
    },
    {
      id: "claude-code",
      name: t("connectors.list.claudeCode.name"),
      tier: "Local Native",
      description: t("connectors.list.claudeCode.description"),
      icon: ">_",
      capabilities: [
        t("connectors.list.claudeCode.cap1"),
        t("connectors.list.claudeCode.cap2"),
      ],
    },
    {
      id: "cursor",
      name: t("connectors.list.cursor.name"),
      tier: "Local Native",
      description: t("connectors.list.cursor.description"),
      icon: "↗",
      capabilities: [
        t("connectors.list.cursor.cap1"),
        t("connectors.list.cursor.cap2"),
      ],
    },
    {
      id: "windsurf",
      name: t("connectors.list.windsurf.name"),
      tier: "Local Native",
      description: t("connectors.list.windsurf.description"),
      icon: "W",
      capabilities: [
        t("connectors.list.windsurf.cap1"),
        t("connectors.list.windsurf.cap2"),
      ],
    },
    {
      id: "chatgpt",
      name: t("connectors.list.chatgpt.name"),
      tier: "Local Native",
      description: t("connectors.list.chatgpt.description"),
      icon: "G",
      capabilities: [
        t("connectors.list.chatgpt.cap1"),
        t("connectors.list.chatgpt.cap2"),
        t("connectors.list.chatgpt.cap3"),
      ],
    },
    {
      id: "gemini-cli",
      name: t("connectors.list.geminiCli.name"),
      tier: "Local Native",
      description: t("connectors.list.geminiCli.description"),
      icon: "♊",
      capabilities: [
        t("connectors.list.geminiCli.cap1"),
        t("connectors.list.geminiCli.cap2"),
      ],
    },
    {
      id: "gemini",
      name: t("connectors.list.geminiWeb.name"),
      tier: "Bridge",
      description: t("connectors.list.geminiWeb.description"),
      icon: "✦",
      capabilities: [
        t("connectors.list.geminiWeb.cap1"),
        t("connectors.list.geminiWeb.cap2"),
      ],
    },
    {
      id: "copilot",
      name: t("connectors.list.copilot.name"),
      tier: "Bridge",
      description: t("connectors.list.copilot.description"),
      icon: "⊙",
      capabilities: [
        t("connectors.list.copilot.cap1"),
        t("connectors.list.copilot.cap2"),
      ],
    },
  ], [t]);

  const TIER_COLORS: Record<IntegrationTier, { bg: string; text: string; label: string }> = {
    "Local Native": { bg: "var(--bg-2)", text: "var(--success)", label: t("connectors.tiers.localNative") },
    "Bridge": { bg: "var(--bg-2)", text: "var(--warning)", label: t("connectors.tiers.bridge") },
  };

  useEffect(() => {
    getMcpConnectionInfo().then(setInfo).catch(console.error);
  }, []);

  const active = CONNECTORS.find((c) => c.id === activeConnector);

  const copyWithFeedback = async (text: string, key: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  const handleBridgeAction = async (action: "copy" | "handoff") => {
    setBridgeStatus("loading");
    setBridgeFeedback("");
    setBridgeError(null);
    try {
      const budget = action === "handoff" ? 6000 : 4000;
      const memories = await simulateContext("general project context", budget);
      const connectorName = active?.name ?? "the selected tool";

      let text: string;
      if (action === "handoff") {
        text = [
          t("connectors.bridge.handoff.title", { name: connectorName }),
          "",
          t("connectors.bridge.handoff.date", { date: new Date().toLocaleString() }),
          "",
          t("connectors.bridge.handoff.instructionsTitle"),
          t("connectors.bridge.handoff.instructions", { name: connectorName }),
          "",
          t("connectors.bridge.handoff.memoriesTitle"),
          "",
          ...memories.map((m) => `### [${m.memory_id}] (${m.ontology})\n${m.l0}`),
        ].join("\n");
      } else {
        text = memories.map((m) => `## ${m.memory_id}\n${m.l0}`).join("\n\n");
      }

      await navigator.clipboard.writeText(text);
      if (action === "handoff") {
        if (!info) {
          throw new Error("Could not resolve workspace location");
        }
        const handoffPath = `${info.workspace_root}/.ai/scratch/handoff.md`;
        await writeFile(handoffPath, text);
        setBridgeFeedback(t("connectors.bridge.handoffSuccess"));
      } else {
        setBridgeFeedback(t("connectors.bridge.copySuccess"));
      }
      setBridgeText(text);
      setBridgeStatus("done");
    } catch {
      setBridgeError(t("connectors.bridge.error"));
      setBridgeStatus("idle");
    }
  };

  return (
    <div className="view-container h-full overflow-y-auto" style={{ padding: 24 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4, color: "var(--text-0)" }}>
        {t("connectors.title")}
      </h1>
      <p style={{ fontSize: 13, color: "var(--text-2)", marginBottom: 20 }}>
        {t("connectors.description")}
      </p>

      {/* MCP server status */}
      {info && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "8px 14px",
            marginBottom: 16,
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: "var(--bg-1)",
            fontSize: 12,
          }}
        >
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: info.is_http_running ? "var(--success)" : "var(--danger)",
              flexShrink: 0,
            }}
          />
          <span style={{ color: "var(--text-1)" }}>
            {t("connectors.status.mcpHttp", {
              status: info.is_http_running ? t("connectors.status.active") : t("connectors.status.inactive"),
              url: info.http_url
            })}
          </span>
        </div>
      )}

      <div style={{ display: "flex", gap: 16 }}>
        {/* Connector list */}
        <div style={{ width: 200, flexShrink: 0 }}>
          {(["Local Native", "Bridge"] as IntegrationTier[]).map((tier) => (
            <div key={tier}>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: TIER_COLORS[tier].text,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  padding: "6px 4px 4px",
                  marginTop: tier === "Bridge" ? 8 : 0,
                }}
              >
                {TIER_COLORS[tier].label}
              </div>
              {CONNECTORS.filter((c) => c.tier === tier).map((c) => (
                <button
                  key={c.id}
                  onClick={() => {
                    setActiveConnector(c.id);
                    setBridgeStatus("idle");
                    setBridgeText("");
                    setBridgeFeedback("");
                    setBridgeError(null);
                  }}
                  className={clsx(
                    "w-full text-left rounded-lg border px-3 py-2 mb-1 transition-colors",
                    activeConnector === c.id
                      ? "border-[color:var(--accent)] bg-[color:var(--accent-muted)]"
                      : "border-[var(--border)] bg-[color:var(--bg-1)] hover:border-[var(--border-active)]"
                  )}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: 5,
                        background: "var(--bg-2)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 10,
                        fontWeight: 700,
                        color: "var(--text-1)",
                        flexShrink: 0,
                      }}
                    >
                      {c.icon}
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-0)" }}>
                      {c.name}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          ))}
        </div>

        {/* Detail panel */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {active && (
            <div className="card" style={{ padding: 20 }}>
              {/* Header */}
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 8,
                    background: "var(--bg-2)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 14,
                    fontWeight: 700,
                    color: "var(--text-1)",
                  }}
                >
                  {active.icon}
                </div>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-0)" }}>
                    {active.name}
                  </div>
                  <div
                    style={{
                      display: "inline-block",
                      padding: "2px 8px",
                      borderRadius: 10,
                      fontSize: 11,
                      fontWeight: 600,
                      background: TIER_COLORS[active.tier].bg,
                      color: TIER_COLORS[active.tier].text,
                    }}
                  >
                    {TIER_COLORS[active.tier].label}
                  </div>
                </div>
              </div>

              <p style={{ fontSize: 13, color: "var(--text-2)", marginBottom: 14 }}>
                {active.description}
              </p>

              {/* Capabilities */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-2)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  {t("connectors.sections.capabilities")}
                </div>
                {active.capabilities.map((cap) => (
                  <div key={cap} style={{ display: "flex", alignItems: "flex-start", gap: 6, fontSize: 12, color: "var(--text-1)", marginBottom: 4 }}>
                    <span style={{ color: "var(--accent)", flexShrink: 0, marginTop: 1 }}>•</span>
                    {cap}
                  </div>
                ))}
              </div>

              {/* ─── Configuration panels per connector ─── */}

              {active.id === "claude-desktop" && info && (
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <div>
                    <SectionLabel>{t("connectors.sections.coworkRecommended")}</SectionLabel>
                    <p style={{ fontSize: 12, color: "var(--text-2)", marginBottom: 8 }}>
                      <Trans
                        i18nKey="connectors.sections.coworkDesc"
                        components={{ bold: <b /> }}
                      />
                    </p>
                  </div>

                  <div>
                    <SectionLabel>{t("connectors.sections.mcpStdio")}</SectionLabel>
                    <p style={{ fontSize: 12, color: "var(--text-2)", marginBottom: 8 }}>
                      <Trans
                        i18nKey="connectors.sections.mcpStdioDesc"
                        components={{ code: <code style={{ color: "var(--accent)" }} /> }}
                      />
                    </p>
                    {(() => {
                      const config = JSON.stringify(
                        {
                          mcpServers: {
                            "ai-context-os": {
                              command: info.binary_path,
                              args: ["mcp-server", "--root", info.workspace_root],
                            },
                          },
                        },
                        null,
                        2
                      );
                      return (
                        <SnippetCard
                          snippet={config}
                          onCopy={() => copyWithFeedback(config, "claude-desktop")}
                          copied={copied === "claude-desktop"}
                        />
                      );
                    })()}
                  </div>
                  <InfoBox>
                    <Trans
                      i18nKey="connectors.sections.coworkMcpInfo"
                      components={{ bold: <strong /> }}
                    />
                  </InfoBox>
                </div>
              )}

              {active.id === "claude-code" && info && (
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  {/* Option 1: MCP register */}
                  <div>
                    <SectionLabel>{t("connectors.sections.mcpRegister")}</SectionLabel>
                    <p style={{ fontSize: 12, color: "var(--text-2)", marginBottom: 8 }}>
                      <Trans
                        i18nKey="connectors.sections.mcpRegisterDesc"
                        components={{ code: <code style={{ color: "var(--accent)" }} /> }}
                      />
                    </p>
                    <SnippetCard
                      snippet={`claude mcp add ai-context-os -- "${info.binary_path}" mcp-server --root "${info.workspace_root}"`}
                      onCopy={() => copyWithFeedback(
                        `claude mcp add ai-context-os -- "${info.binary_path}" mcp-server --root "${info.workspace_root}"`,
                        "mcp-add"
                      )}
                      copied={copied === "mcp-add"}
                    />
                  </div>

                  {/* Option 2: claude.md only */}
                  <div>
                    <SectionLabel>{t("connectors.sections.openWorkspace")}</SectionLabel>
                    <p style={{ fontSize: 12, color: "var(--text-2)", marginBottom: 8 }}>
                      <Trans
                        i18nKey="connectors.sections.openWorkspaceDesc"
                        components={{
                          code: <code style={{ color: "var(--accent)" }} />,
                          bold: <strong />
                        }}
                      />
                    </p>
                    <SnippetCard
                      snippet={`claude "${info.workspace_root}"`}
                      onCopy={() => copyWithFeedback(`claude "${info.workspace_root}"`, "terminal")}
                      copied={copied === "terminal"}
                    />
                  </div>

                  <InfoBox>
                    <Trans
                      i18nKey="connectors.sections.terminalTip"
                      components={{ bold: <strong /> }}
                    />
                  </InfoBox>
                </div>
              )}

              {active.id === "cursor" && info && (
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <div>
                    <SectionLabel>{t("connectors.sections.mcpHttp")}</SectionLabel>
                    <p style={{ fontSize: 12, color: "var(--text-2)", marginBottom: 8 }}>
                      <Trans
                        i18nKey="connectors.sections.mcpHttpDescCursor"
                        components={{ code: <code style={{ color: "var(--accent)" }} /> }}
                      />
                    </p>
                    {(() => {
                      const config = JSON.stringify(
                        { mcpServers: { "ai-context-os": { type: "sse", url: info.http_url } } },
                        null,
                        2
                      );
                      return (
                        <SnippetCard
                          snippet={config}
                          onCopy={() => copyWithFeedback(config, "cursor-mcp")}
                          copied={copied === "cursor-mcp"}
                        />
                      );
                    })()}
                  </div>
                  <div>
                    <SectionLabel>{t("connectors.sections.cursorrulesStatic")}</SectionLabel>
                    <p style={{ fontSize: 12, color: "var(--text-2)", marginBottom: 8 }}>
                      <Trans
                        i18nKey="connectors.sections.cursorrulesStaticDesc"
                        components={{ code: <code style={{ color: "var(--accent)" }} /> }}
                      />
                    </p>
                  </div>
                  <InfoBox>
                    <Trans
                      i18nKey="connectors.sections.mcpVsRules"
                      components={{ bold: <strong /> }}
                    />
                  </InfoBox>
                </div>
              )}

              {active.id === "windsurf" && info && (
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <div>
                    <SectionLabel>{t("connectors.sections.mcpHttp")}</SectionLabel>
                    <p style={{ fontSize: 12, color: "var(--text-2)", marginBottom: 8 }}>
                      {t("connectors.sections.mcpHttpDescWindsurf")}
                    </p>
                    {(() => {
                      const config = JSON.stringify(
                        { mcpServers: { "ai-context-os": { url: info.http_url } } },
                        null,
                        2
                      );
                      return (
                        <SnippetCard
                          snippet={config}
                          onCopy={() => copyWithFeedback(config, "windsurf-mcp")}
                          copied={copied === "windsurf-mcp"}
                        />
                      );
                    })()}
                  </div>
                  <div>
                    <SectionLabel>{t("connectors.sections.windsurfrulesStatic")}</SectionLabel>
                    <p style={{ fontSize: 12, color: "var(--text-2)" }}>
                      <Trans
                        i18nKey="connectors.sections.windsurfrulesStaticDesc"
                        components={{ code: <code style={{ color: "var(--accent)" }} /> }}
                      />
                    </p>
                  </div>
                </div>
              )}

              {active.id === "chatgpt" && info && (
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <div>
                    <SectionLabel>{t("connectors.sections.codexCli")}</SectionLabel>
                    <p style={{ fontSize: 12, color: "var(--text-2)", marginBottom: 8 }}>
                      <Trans
                        i18nKey="connectors.sections.codexCliDesc"
                        components={{
                          linkCodex: <a href="https://github.com/openai/codex" target="_blank" rel="noreferrer" style={{ color: "var(--accent)", textDecoration: "underline" }} />,
                          code: <code style={{ color: "var(--accent)" }} />
                        }}
                      />
                    </p>
                    {(() => {
                      const config = `mcp_servers:\n  - name: ai-context-os\n    command: "${info.binary_path}"\n    args:\n      - mcp-server\n      - --root\n      - "${info.workspace_root}"`;
                      return (
                        <SnippetCard
                          snippet={config}
                          onCopy={() => copyWithFeedback(config, "codex-mcp")}
                          copied={copied === "codex-mcp"}
                        />
                      );
                    })()}
                  </div>
                  <InfoBox>
                    <Trans
                      i18nKey="connectors.sections.codexInfo"
                      components={{ bold: <strong /> }}
                    />
                  </InfoBox>

                  <div>
                    <SectionLabel>{t("connectors.sections.chatgptWeb")}</SectionLabel>
                    <p style={{ fontSize: 12, color: "var(--text-2)", marginBottom: 8 }}>
                      <Trans
                        i18nKey="connectors.sections.chatgptWebDesc"
                        components={{ bold: <strong /> }}
                      />
                    </p>
                  </div>
                  <BridgePanel
                    connectorId={active.id}
                    status={bridgeStatus}
                    resultText={bridgeText}
                    feedback={bridgeFeedback}
                    error={bridgeError}
                    onAction={handleBridgeAction}
                  />
                </div>
              )}

              {active.id === "gemini-cli" && info && (
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <div>
                    <SectionLabel>{t("connectors.sections.mcpRegister")}</SectionLabel>
                    <p style={{ fontSize: 12, color: "var(--text-2)", marginBottom: 8 }}>
                      <Trans
                        i18nKey="connectors.sections.geminiMcpDesc"
                        components={{
                          linkGemini: <a href="https://github.com/google-gemini/gemini-cli" target="_blank" rel="noreferrer" style={{ color: "var(--accent)", textDecoration: "underline" }} />
                        }}
                      />
                    </p>
                    <SnippetCard
                      snippet={`gemini mcp add ai-context-os -- "${info.binary_path}" mcp-server --root "${info.workspace_root}"`}
                      onCopy={() => copyWithFeedback(
                        `gemini mcp add ai-context-os -- "${info.binary_path}" mcp-server --root "${info.workspace_root}"`,
                        "gemini-mcp-add"
                      )}
                      copied={copied === "gemini-mcp-add"}
                    />
                  </div>

                  <div>
                    <SectionLabel>{t("connectors.sections.geminiSettings")}</SectionLabel>
                    <p style={{ fontSize: 12, color: "var(--text-2)", marginBottom: 8 }}>
                      <Trans
                        i18nKey="connectors.sections.geminiSettingsDesc"
                        components={{ code: <code style={{ color: "var(--accent)" }} /> }}
                      />
                    </p>
                    {(() => {
                      const config = JSON.stringify(
                        {
                          mcpServers: {
                            "ai-context-os": {
                              command: info.binary_path,
                              args: ["mcp-server", "--root", info.workspace_root],
                            },
                          },
                        },
                        null,
                        2
                      );
                      return (
                        <SnippetCard
                          snippet={config}
                          onCopy={() => copyWithFeedback(config, "gemini-settings")}
                          copied={copied === "gemini-settings"}
                        />
                      );
                    })()}
                  </div>

                  <InfoBox>
                    {t("connectors.sections.geminiInfo")}
                  </InfoBox>
                </div>
              )}

              {active.tier === "Bridge" && active.id !== "chatgpt" && (
                <BridgePanel
                  connectorId={active.id}
                  status={bridgeStatus}
                  resultText={bridgeText}
                  feedback={bridgeFeedback}
                  error={bridgeError}
                  onAction={handleBridgeAction}
                />
              )}

              {!info && active.tier === "Local Native" && (
                <NullInfoBanner />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Bridge panel ─────────────────────────────────────────────────────────────

function BridgePanel({
  connectorId,
  status,
  resultText,
  feedback,
  error,
  onAction,
}: {
  connectorId: string;
  status: "idle" | "loading" | "done";
  resultText: string;
  feedback: string;
  error: string | null;
  onAction: (action: "copy" | "handoff") => void;
}) {
  const { t } = useTranslation();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div
        style={{
          padding: "10px 14px",
          borderRadius: 8,
          background: "var(--bg-2)",
          border: "1px solid var(--warning)",
          fontSize: 12,
          color: "var(--text-2)",
        }}
      >
        <Trans
          i18nKey="connectors.bridge.manualTransfer"
          components={{ bold: <strong style={{ color: "var(--text-1)" }} /> }}
        />
      </div>

      {connectorId === "copilot" && (
        <div
          style={{
            padding: "10px 14px",
            borderRadius: 8,
            background: "var(--bg-2)",
            fontSize: 12,
            color: "var(--text-2)",
          }}
        >
          <Trans
            i18nKey="connectors.bridge.copilotNote"
            components={{
              bold: <strong />,
              code: <code style={{ color: "var(--accent)" }} />
            }}
          />
        </div>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <ActionButton
          icon={<Copy size={13} />}
          label={t("connectors.bridge.copyContext")}
          loading={status === "loading"}
          onClick={() => onAction("copy")}
        />
        <ActionButton
          icon={<FileText size={13} />}
          label={t("connectors.bridge.generateHandoff")}
          loading={status === "loading"}
          onClick={() => onAction("handoff")}
        />
      </div>

      {feedback && (
        <div style={{ fontSize: 11, color: "var(--accent)" }}>{feedback}</div>
      )}

      {error && (
        <div style={{ fontSize: 11, color: "var(--danger)" }}>{error}</div>
      )}

      {status === "done" && resultText && (
        <div>
          <div style={{ fontSize: 11, color: "var(--accent)", marginBottom: 4 }}>{t("connectors.bridge.preview")}</div>
          <pre
            style={{
              padding: 10,
              background: "var(--bg-0)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              fontSize: 11,
              color: "var(--text-2)",
              overflow: "auto",
              whiteSpace: "pre-wrap",
              maxHeight: 200,
              margin: 0,
            }}
          >
            {resultText.slice(0, 800)}{resultText.length > 800 ? "\n..." : ""}
          </pre>
        </div>
      )}
    </div>
  );
}

// ─── Shared UI components ─────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-0)", marginBottom: 4 }}>
      {children}
    </div>
  );
}

function InfoBox({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: "10px 14px",
        borderRadius: 8,
        background: "var(--bg-2)",
        border: "1px solid var(--border)",
        fontSize: 12,
        color: "var(--text-2)",
        lineHeight: 1.5,
      }}
    >
      {children}
    </div>
  );
}

function SnippetCard({
  snippet,
  onCopy,
  copied,
}: {
  snippet: string;
  onCopy: () => void;
  copied: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={onCopy}
        style={{
          position: "absolute",
          top: 6,
          right: 6,
          padding: "3px 8px",
          fontSize: 11,
          background: "var(--bg-2)",
          color: copied ? "var(--accent)" : "var(--text-2)",
          border: "1px solid var(--border)",
          borderRadius: 4,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 3,
          zIndex: 1,
        }}
      >
        {copied ? <><Check size={11} /> {t("connectors.actions.copied")}</> : <><Copy size={11} /> {t("connectors.actions.copy")}</>}
      </button>
      <pre
        style={{
          padding: "10px 80px 10px 10px",
          background: "var(--bg-0)",
          border: "1px solid var(--border)",
          borderRadius: 6,
          fontSize: 11,
          color: "var(--text-1)",
          overflow: "auto",
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
          margin: 0,
        }}
      >
        {snippet}
      </pre>
    </div>
  );
}

function NullInfoBanner() {
  const { t } = useTranslation();
  return (
    <div
      style={{
        padding: "12px 16px",
        borderRadius: 8,
        background: "var(--bg-2)",
        border: "1px solid var(--danger)",
        fontSize: 12,
        color: "var(--text-2)",
        lineHeight: 1.6,
      }}
    >
      <Trans
        i18nKey="connectors.nullInfo.description"
        components={{
          bold: <strong style={{ color: "var(--danger)" }} />,
          boldSettings: <strong style={{ color: "var(--text-1)" }} />
        }}
      />
    </div>
  );
}

function ActionButton({
  icon,
  label,
  loading,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  loading: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  return (
    <button
      onClick={onClick}
      disabled={loading}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "7px 14px",
        fontSize: 12,
        fontWeight: 500,
        background: "var(--bg-2)",
        color: "var(--text-1)",
        border: "1px solid var(--border)",
        borderRadius: 6,
        cursor: loading ? "not-allowed" : "pointer",
        opacity: loading ? 0.5 : 1,
        transition: "opacity 0.15s",
      }}
    >
      {icon}
      {loading ? t("connectors.bridge.generating") : label}
    </button>
  );
}
