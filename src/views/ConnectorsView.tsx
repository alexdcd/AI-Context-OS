// Nota: en una iteración posterior, mover tipos y lista de conectores a src/lib/connectors.ts
import { useEffect, useState } from "react";
import { Copy, FileText, Check } from "lucide-react";
import { clsx } from "clsx";
import { getMcpConnectionInfo, simulateContext } from "../lib/tauri";
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
    id: "claude-code",
    name: "Claude Code",
    tier: "Local Native",
    description: "Integración completa: MCP nativo con 4 herramientas + contexto automático vía claude.md.",
    icon: ">_",
    capabilities: [
      "MCP stdio (get_context, save_memory, get_skill, log_session)",
      "Lectura automática de claude.md al abrir el workspace",
      "Cowork: sesión colaborativa con acceso directo a archivos",
    ],
  },
  {
    id: "claude-desktop",
    name: "Claude Desktop",
    tier: "Local Native",
    description: "Servidor MCP vía stdio. Claude accede a las 4 herramientas del workspace.",
    icon: "C",
    capabilities: [
      "MCP stdio (get_context, save_memory, get_skill, log_session)",
      "Contexto completo con scoring híbrido y niveles L0/L1/L2",
    ],
  },
  {
    id: "cursor",
    name: "Cursor",
    tier: "Local Native",
    description: "MCP vía HTTP (requiere app abierta) + .cursorrules estático siempre disponible.",
    icon: "↗",
    capabilities: [
      "MCP HTTP en puerto 3847 (mismas 4 herramientas, requiere app corriendo)",
      ".cursorrules auto-generado con reglas y contexto base",
    ],
  },
  {
    id: "windsurf",
    name: "Windsurf",
    tier: "Local Native",
    description: "MCP vía HTTP (requiere app abierta) + .windsurfrules estático siempre disponible.",
    icon: "W",
    capabilities: [
      "MCP HTTP en puerto 3847 (requiere app corriendo)",
      ".windsurfrules auto-generado con reglas y contexto base",
    ],
  },
  {
    id: "chatgpt",
    name: "ChatGPT / Codex",
    tier: "Local Native",
    description: "Integración completa vía Codex CLI con soporte MCP nativo. También handoff manual para ChatGPT web.",
    icon: "G",
    capabilities: [
      "MCP stdio vía Codex CLI (get_context, save_memory, get_skill, log_session)",
      "Codex trabaja directamente en la carpeta raíz con acceso a archivos",
      "Handoff manual para ChatGPT web (copiar/pegar contexto)",
    ],
  },
  {
    id: "gemini",
    name: "Gemini Web",
    tier: "Bridge",
    description: "Sin integración nativa. Transferencia manual del contexto óptimo.",
    icon: "♊",
    capabilities: [
      "Copiar contexto optimizado al portapapeles",
      "Generar handoff.md con resumen estructurado",
    ],
  },
  {
    id: "copilot",
    name: "GitHub Copilot",
    tier: "Bridge",
    description: "Sin MCP nativo. Usa .cursorrules como contexto estático si el editor lo soporta.",
    icon: "⊙",
    capabilities: [
      "Contexto estático vía .cursorrules (en editores compatibles)",
      "Copiar contexto optimizado al portapapeles",
    ],
  },
];

const TIER_COLORS: Record<IntegrationTier, { bg: string; text: string; label: string }> = {
  "Local Native": { bg: "#10b98122", text: "#10b981", label: "Local Native" },
  "Bridge":       { bg: "#f59e0b22", text: "#f59e0b", label: "Bridge" },
};

export function ConnectorsView() {
  const [info, setInfo] = useState<McpConnectionInfo | null>(null);
  const [activeConnector, setActiveConnector] = useState<string>("claude-code");
  const [bridgeStatus, setBridgeStatus] = useState<"idle" | "loading" | "done">("idle");
  const [bridgeText, setBridgeText] = useState<string>("");
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
    try {
      const budget = action === "handoff" ? 6000 : 4000;
      const memories = await simulateContext("contexto general del proyecto", budget);

      let text: string;
      if (action === "handoff") {
        text = [
          "# Handoff — AI Context OS",
          "",
          `Fecha: ${new Date().toLocaleString()}`,
          "",
          "## Instrucciones",
          "Este documento contiene el contexto activo de mi workspace de memorias.",
          "Úsalo como referencia para entender mi proyecto y responder mis preguntas.",
          "",
          "## Memorias activas",
          "",
          ...memories.map((m) => `### [${m.memory_id}] (${m.memory_type})\n${m.l0}`),
        ].join("\n");
      } else {
        text = memories.map((m) => `## ${m.memory_id}\n${m.l0}`).join("\n\n");
      }

      await navigator.clipboard.writeText(text);
      setBridgeText(text);
      setBridgeStatus("done");
    } catch {
      setBridgeStatus("idle");
    }
  };

  return (
    <div className="view-container h-full overflow-y-auto" style={{ padding: 24 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4, color: "var(--text-0)" }}>
        Conectores
      </h1>
      <p style={{ fontSize: 13, color: "var(--text-2)", marginBottom: 20 }}>
        Integra AI Context OS con tus herramientas de IA.
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
              background: info.is_http_running ? "#10b981" : "#ef4444",
              flexShrink: 0,
            }}
          />
          <span style={{ color: "var(--text-1)" }}>
            MCP HTTP: {info.is_http_running ? "activo" : "inactivo"} en{" "}
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
                    {active.tier}
                  </div>
                </div>
              </div>

              <p style={{ fontSize: 13, color: "var(--text-2)", marginBottom: 14 }}>
                {active.description}
              </p>

              {/* Capabilities */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-2)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  Capacidades
                </div>
                {active.capabilities.map((cap) => (
                  <div key={cap} style={{ display: "flex", alignItems: "flex-start", gap: 6, fontSize: 12, color: "var(--text-1)", marginBottom: 4 }}>
                    <span style={{ color: "var(--accent)", flexShrink: 0, marginTop: 1 }}>•</span>
                    {cap}
                  </div>
                ))}
              </div>

              {/* ─── Configuration panels per connector ─── */}

              {active.id === "claude-code" && info && (
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  {/* Option 1: Cowork */}
                  <div>
                    <SectionLabel>Opción 1 — Cowork (recomendado)</SectionLabel>
                    <p style={{ fontSize: 12, color: "var(--text-2)", marginBottom: 8 }}>
                      Abre una sesión colaborativa directamente en la carpeta raíz.
                      Claude Code lee <code style={{ color: "var(--accent)" }}>claude.md</code> automáticamente
                      y tiene acceso completo a los archivos del workspace.
                    </p>
                    <SnippetCard
                      snippet={`claude cowork "${info.workspace_root}"`}
                      onCopy={() => copyWithFeedback(`claude cowork "${info.workspace_root}"`, "cowork")}
                      copied={copied === "cowork"}
                    />
                  </div>

                  {/* Option 2: MCP add */}
                  <div>
                    <SectionLabel>Opción 2 — Registrar servidor MCP</SectionLabel>
                    <p style={{ fontSize: 12, color: "var(--text-2)", marginBottom: 8 }}>
                      Registra AI Context OS como servidor MCP permanente.
                      Disponible en cualquier proyecto, no solo en esta carpeta.
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

                  <InfoBox>
                    <strong>Cowork vs MCP:</strong> Cowork da acceso directo a archivos + lectura de claude.md.
                    MCP expone las 4 herramientas de scoring inteligente (get_context, save_memory, get_skill, log_session).
                    Pueden usarse juntos.
                  </InfoBox>
                </div>
              )}

              {active.id === "claude-desktop" && info && (
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <div>
                    <SectionLabel>Configuración MCP (stdio)</SectionLabel>
                    <p style={{ fontSize: 12, color: "var(--text-2)", marginBottom: 8 }}>
                      Agrega este bloque a{" "}
                      <code style={{ color: "var(--accent)" }}>~/Library/Application Support/Claude/claude_desktop_config.json</code>:
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
                    Después de guardar, reinicia Claude Desktop. El servidor MCP se lanza automáticamente con cada conversación.
                  </InfoBox>
                </div>
              )}

              {active.id === "cursor" && info && (
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <div>
                    <SectionLabel>Opción 1 — MCP HTTP (dinámico, requiere app abierta)</SectionLabel>
                    <p style={{ fontSize: 12, color: "var(--text-2)", marginBottom: 8 }}>
                      Agrega a <code style={{ color: "var(--accent)" }}>.cursor/mcp.json</code> en tu proyecto:
                    </p>
                    {(() => {
                      const config = JSON.stringify(
                        { mcpServers: { "ai-context-os": { url: `${info.http_url}/mcp` } } },
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
                    <SectionLabel>Opción 2 — .cursorrules (estático, siempre disponible)</SectionLabel>
                    <p style={{ fontSize: 12, color: "var(--text-2)", marginBottom: 8 }}>
                      El archivo <code style={{ color: "var(--accent)" }}>.cursorrules</code> se
                      auto-genera en la raíz del workspace con reglas y contexto base.
                      Cursor lo lee automáticamente sin configuración.
                    </p>
                  </div>
                  <InfoBox>
                    <strong>MCP vs .cursorrules:</strong> MCP da acceso dinámico a scoring, memorias y herramientas.
                    .cursorrules es estático pero no requiere que la app esté corriendo.
                  </InfoBox>
                </div>
              )}

              {active.id === "windsurf" && info && (
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <div>
                    <SectionLabel>Opción 1 — MCP HTTP (dinámico, requiere app abierta)</SectionLabel>
                    <p style={{ fontSize: 12, color: "var(--text-2)", marginBottom: 8 }}>
                      Configura en los ajustes MCP de Windsurf:
                    </p>
                    {(() => {
                      const config = JSON.stringify(
                        { mcpServers: { "ai-context-os": { url: `${info.http_url}/mcp` } } },
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
                    <SectionLabel>Opción 2 — .windsurfrules (estático, siempre disponible)</SectionLabel>
                    <p style={{ fontSize: 12, color: "var(--text-2)" }}>
                      El archivo <code style={{ color: "var(--accent)" }}>.windsurfrules</code> se
                      auto-genera en la raíz del workspace. Windsurf lo lee sin configuración adicional.
                    </p>
                  </div>
                </div>
              )}

              {active.id === "chatgpt" && info && (
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <div>
                    <SectionLabel>Opción 1 — Codex CLI (recomendado)</SectionLabel>
                    <p style={{ fontSize: 12, color: "var(--text-2)", marginBottom: 8 }}>
                      <a href="https://github.com/openai/codex" target="_blank" rel="noreferrer"
                        style={{ color: "var(--accent)", textDecoration: "underline" }}>
                        Codex CLI
                      </a>{" "}
                      soporta servidores MCP nativos. Configura en{" "}
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
                    <strong>Codex CLI</strong> ejecuta modelos de OpenAI con acceso MCP directo.
                    Es la mejor vía para usar AI Context OS con el ecosistema ChatGPT/OpenAI.
                  </InfoBox>

                  <div>
                    <SectionLabel>Opción 2 — ChatGPT web (handoff manual)</SectionLabel>
                    <p style={{ fontSize: 12, color: "var(--text-2)", marginBottom: 8 }}>
                      Para ChatGPT web sin Codex, transfiere el contexto manualmente.
                    </p>
                  </div>
                  <BridgePanel
                    connectorId={active.id}
                    status={bridgeStatus}
                    resultText={bridgeText}
                    onAction={handleBridgeAction}
                  />
                </div>
              )}

              {active.tier === "Bridge" && active.id !== "chatgpt" && (
                <BridgePanel
                  connectorId={active.id}
                  status={bridgeStatus}
                  resultText={bridgeText}
                  onAction={handleBridgeAction}
                />
              )}

              {!info && active.tier === "Local Native" && (
                <div style={{ fontSize: 13, color: "var(--text-2)" }}>
                  Cargando información de conexión...
                </div>
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
  onAction,
}: {
  connectorId: string;
  status: "idle" | "loading" | "done";
  resultText: string;
  onAction: (action: "copy" | "handoff") => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div
        style={{
          padding: "10px 14px",
          borderRadius: 8,
          background: "#f59e0b11",
          border: "1px solid #f59e0b33",
          fontSize: 12,
          color: "var(--text-2)",
        }}
      >
        <strong style={{ color: "var(--text-1)" }}>Bridge / Handoff</strong> — Transferencia
        guiada del estado de trabajo. No hay integración nativa; el contexto se prepara para
        pegarlo manualmente.
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
          Copilot lee <code style={{ color: "var(--accent)" }}>.cursorrules</code> en algunos
          editores. Si tu editor lo soporta, el contexto base estará disponible automáticamente.
        </div>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <ActionButton
          icon={<Copy size={13} />}
          label="Copiar contexto óptimo"
          loading={status === "loading"}
          onClick={() => onAction("copy")}
        />
        <ActionButton
          icon={<FileText size={13} />}
          label="Generar handoff.md"
          loading={status === "loading"}
          onClick={() => onAction("handoff")}
        />
      </div>

      {status === "done" && resultText && (
        <div>
          <div style={{ fontSize: 11, color: "var(--accent)", marginBottom: 4 }}>
            Copiado al portapapeles
          </div>
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
        {copied ? <><Check size={11} /> Copiado</> : <><Copy size={11} /> Copiar</>}
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
      {loading ? "Generando..." : label}
    </button>
  );
}
