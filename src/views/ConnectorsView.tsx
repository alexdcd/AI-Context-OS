// Nota: en una iteración posterior, mover tipos y lista de conectores a src/lib/connectors.ts
import { useEffect, useState } from "react";
import { Copy, FileText, Check } from "lucide-react";
import { clsx } from "clsx";
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

const CONNECTORS: ConnectorDef[] = [
  {
    id: "claude-desktop",
    name: "Claude Desktop",
    tier: "Local Native",
    description: "Native app (recommended). Cowork session with automatic access to context and MCP.",
    icon: "C",
    capabilities: [
      "Cowork: the optimal way to work with your files",
      "Automatic stdio MCP (get_context, save_memory, get_skill, log_session)",
      "Automatic reading of claude.md"
    ],
  },
  {
    id: "claude-code",
    name: "Claude Code",
    tier: "Local Native",
    description: "CLI integration: Native MCP with 4 tools + automatic context.",
    icon: ">_",
    capabilities: [
      "stdio MCP in the terminal",
      "Automatic reading of claude.md when opening the workspace",
    ],
  },
  {
    id: "cursor",
    name: "Cursor",
    tier: "Local Native",
    description: "HTTP MCP (requires open app) + static .cursorrules always available.",
    icon: "↗",
    capabilities: [
      "HTTP MCP on port 3847 (same 4 tools, requires app running)",
      "Auto-generated .cursorrules with rules and base context",
    ],
  },
  {
    id: "windsurf",
    name: "Windsurf",
    tier: "Local Native",
    description: "HTTP MCP (requires open app) + static .windsurfrules always available.",
    icon: "W",
    capabilities: [
      "HTTP MCP on port 3847 (requires app running)",
      "Auto-generated .windsurfrules with rules and base context",
    ],
  },
  {
    id: "chatgpt",
    name: "ChatGPT / Codex",
    tier: "Local Native",
    description: "Full integration via Codex CLI with native MCP support. Also manual handoff for ChatGPT web.",
    icon: "G",
    capabilities: [
      "stdio MCP via Codex CLI (get_context, save_memory, get_skill, log_session)",
      "Codex works directly in the root folder with file access",
      "Manual handoff for ChatGPT web (copy/paste context)",
    ],
  },
  {
    id: "gemini-cli",
    name: "Gemini CLI",
    tier: "Local Native",
    description: "Native MCP via Gemini CLI. Same 4 tools as Claude Code.",
    icon: "♊",
    capabilities: [
      "stdio MCP via Gemini CLI (get_context, save_memory, get_skill, log_session)",
      "Automatic reading of context from workspace root",
    ],
  },
  {
    id: "gemini",
    name: "Gemini Web",
    tier: "Bridge",
    description: "No native integration. Manual transfer of optimal context.",
    icon: "✦",
    capabilities: [
      "Copy optimized context to clipboard",
      "Generate handoff.md with structured summary",
    ],
  },
  {
    id: "copilot",
    name: "GitHub Copilot",
    tier: "Bridge",
    description: "No native MCP. Uses .cursorrules as static context if the editor supports it.",
    icon: "⊙",
    capabilities: [
      "Static context via .cursorrules (in compatible editors)",
      "Copy optimized context to clipboard",
    ],
  },
];

const TIER_COLORS: Record<IntegrationTier, { bg: string; text: string; label: string }> = {
  "Local Native": { bg: "var(--bg-2)", text: "var(--success)", label: "Local Native" },
  "Bridge": { bg: "var(--bg-2)", text: "var(--warning)", label: "Manual Bridge" },
};

export function ConnectorsView() {
  const [info, setInfo] = useState<McpConnectionInfo | null>(null);
  const [activeConnector, setActiveConnector] = useState<string>("claude-desktop");
  const [bridgeStatus, setBridgeStatus] = useState<"idle" | "loading" | "done">("idle");
  const [bridgeText, setBridgeText] = useState<string>("");
  const [bridgeFeedback, setBridgeFeedback] = useState<string>("");
  const [bridgeError, setBridgeError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

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
          `# Handoff for ${connectorName}`,
          "",
          `Date: ${new Date().toLocaleString("en-US")}`,
          "",
          "## Instructions",
          "This document contains the active context of my memory workspace.",
          `Use it as a reference to continue the work in ${connectorName}.`,
          "",
          "## Active memories",
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
        setBridgeFeedback(`File saved to .ai/scratch/handoff.md and copied to clipboard.`);
      } else {
        setBridgeFeedback("Context copied to clipboard.");
      }
      setBridgeText(text);
      setBridgeStatus("done");
    } catch {
      setBridgeError("Could not prepare context transfer.");
      setBridgeStatus("idle");
    }
  };

  return (
    <div className="view-container h-full overflow-y-auto" style={{ padding: 24 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4, color: "var(--text-0)" }}>
        Connectors
      </h1>
      <p style={{ fontSize: 13, color: "var(--text-2)", marginBottom: 20 }}>
        Integrate AI Context OS with your AI tools.
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
            MCP HTTP: {info.is_http_running ? "active" : "inactive"} at{" "}
            <code style={{ color: "var(--accent)" }}>{info.http_url}</code>
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
                  Capabilities
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
                    <SectionLabel>⭐ Option 1 — Cowork (recommended)</SectionLabel>
                    <p style={{ fontSize: 12, color: "var(--text-2)", marginBottom: 8 }}>
                      It's the optimal and easiest way to use our system. Just open
                      the project with the Claude desktop app and use the <b>Cowork</b> tab.
                      Claude will natively access all context and local files.
                    </p>
                  </div>

                  <div>
                    <SectionLabel>Option 2 — MCP server (stdio)</SectionLabel>
                    <p style={{ fontSize: 12, color: "var(--text-2)", marginBottom: 8 }}>
                      To access your knowledge base from any conversation, add AI Context OS to <code style={{ color: "var(--accent)" }}>claude_desktop_config.json</code>:
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
                    <strong>Cowork + MCP:</strong> We recommend using Cowork as the base. If you add MCP configuration, you will have advanced tools like global searches or graphs at your disposal.
                  </InfoBox>
                </div>
              )}

              {active.id === "claude-code" && info && (
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  {/* Option 1: MCP register */}
                  <div>
                    <SectionLabel>⭐ Option 1 — Register MCP server (recommended)</SectionLabel>
                    <p style={{ fontSize: 12, color: "var(--text-2)", marginBottom: 8 }}>
                      Register AI Context OS as a permanent MCP server. This gives Claude Code access to all 4 tools (<code style={{ color: "var(--accent)" }}>get_context</code>, <code style={{ color: "var(--accent)" }}>save_memory</code>, <code style={{ color: "var(--accent)" }}>get_skill</code>, <code style={{ color: "var(--accent)" }}>log_session</code>).
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
                    <SectionLabel>Option 2 — Open workspace (claude.md only)</SectionLabel>
                    <p style={{ fontSize: 12, color: "var(--text-2)", marginBottom: 8 }}>
                      Opens Claude Code in your workspace. The <code style={{ color: "var(--accent)" }}>claude.md</code> is auto-loaded as context, but MCP tools are <strong>not</strong> available without Option 1.
                    </p>
                    <SnippetCard
                      snippet={`claude "${info.workspace_root}"`}
                      onCopy={() => copyWithFeedback(`claude "${info.workspace_root}"`, "terminal")}
                      copied={copied === "terminal"}
                    />
                  </div>

                  <InfoBox>
                    <strong>Tip:</strong> Use both options together — register the MCP server once, then open the workspace with Option 2 for full context + tools.
                  </InfoBox>
                </div>
              )}

              {active.id === "cursor" && info && (
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <div>
                    <SectionLabel>Option 1 — HTTP MCP (dynamic, requires open app)</SectionLabel>
                    <p style={{ fontSize: 12, color: "var(--text-2)", marginBottom: 8 }}>
                      Add to <code style={{ color: "var(--accent)" }}>.cursor/mcp.json</code> in your project:
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
                    <SectionLabel>Option 2 — .cursorrules (static, always available)</SectionLabel>
                    <p style={{ fontSize: 12, color: "var(--text-2)", marginBottom: 8 }}>
                      The <code style={{ color: "var(--accent)" }}>.cursorrules</code> file is
                      auto-generated at the root of the workspace with rules and base context.
                      Cursor reads it automatically without configuration.
                    </p>
                  </div>
                  <InfoBox>
                    <strong>MCP vs .cursorrules:</strong> MCP gives dynamic access to scoring, memories, and tools.
                    .cursorrules is static but does not require the app to be running.
                  </InfoBox>
                </div>
              )}

              {active.id === "windsurf" && info && (
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <div>
                    <SectionLabel>Option 1 — HTTP MCP (dynamic, requires open app)</SectionLabel>
                    <p style={{ fontSize: 12, color: "var(--text-2)", marginBottom: 8 }}>
                      Configure in Windsurf's MCP settings:
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
                    <SectionLabel>Option 2 — .windsurfrules (static, always available)</SectionLabel>
                    <p style={{ fontSize: 12, color: "var(--text-2)" }}>
                      The <code style={{ color: "var(--accent)" }}>.windsurfrules</code> file is
                      auto-generated at the root of the workspace. Windsurf reads it without additional configuration.
                    </p>
                  </div>
                </div>
              )}

              {active.id === "chatgpt" && info && (
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <div>
                    <SectionLabel>Option 1 — Codex CLI (recommended)</SectionLabel>
                    <p style={{ fontSize: 12, color: "var(--text-2)", marginBottom: 8 }}>
                      <a href="https://github.com/openai/codex" target="_blank" rel="noreferrer"
                        style={{ color: "var(--accent)", textDecoration: "underline" }}>
                        Codex CLI
                      </a>{" "}
                      supports native MCP servers. Configure in{" "}
                      <code style={{ color: "var(--accent)" }}>~/.codex/config.yaml</code>:
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
                    <strong>Codex CLI</strong> runs OpenAI models with direct MCP access.
                    It's the best way to use AI Context OS with the ChatGPT/OpenAI ecosystem.
                  </InfoBox>

                  <div>
                    <SectionLabel>Option 2 — ChatGPT web (manual handoff)</SectionLabel>
                    <p style={{ fontSize: 12, color: "var(--text-2)", marginBottom: 8 }}>
                      For ChatGPT web without Codex, generate a context snapshot and paste it at the <strong>beginning of a new conversation</strong> before your first message.
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
                    <SectionLabel>⭐ Option 1 — Register MCP server (recommended)</SectionLabel>
                    <p style={{ fontSize: 12, color: "var(--text-2)", marginBottom: 8 }}>
                      Install{" "}
                      <a href="https://github.com/google-gemini/gemini-cli" target="_blank" rel="noreferrer"
                        style={{ color: "var(--accent)", textDecoration: "underline" }}>
                        Gemini CLI
                      </a>{" "}
                      and register AI Context OS as a permanent MCP server:
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
                    <SectionLabel>Option 2 — settings.json (manual)</SectionLabel>
                    <p style={{ fontSize: 12, color: "var(--text-2)", marginBottom: 8 }}>
                      Or add manually to <code style={{ color: "var(--accent)" }}>~/.gemini/settings.json</code>:
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
                    Gemini CLI supports MCP natively. Once registered, all 4 tools are available in every Gemini CLI session.
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
        <strong style={{ color: "var(--text-1)" }}>Manual Transfer</strong> — Prepares the
        context to copy it or save it as a file when there is no native integration.
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
          <strong>Note:</strong> <code style={{ color: "var(--accent)" }}>.cursorrules</code> is
          read by <strong>Cursor</strong> even with Copilot enabled. It is <strong>not</strong> read
          by GitHub Copilot in VS Code — use the clipboard handoff below instead.
        </div>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <ActionButton
          icon={<Copy size={13} />}
          label="Copy optimal context"
          loading={status === "loading"}
          onClick={() => onAction("copy")}
        />
        <ActionButton
          icon={<FileText size={13} />}
          label="Generate handoff.md"
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
          <div style={{ fontSize: 11, color: "var(--accent)", marginBottom: 4 }}>Preview</div>
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
        {copied ? <><Check size={11} /> Copied</> : <><Copy size={11} /> Copy</>}
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
      {loading ? "Generating..." : label}
    </button>
  );
}
