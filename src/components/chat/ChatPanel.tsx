import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Send, X, Loader2, Sparkles, AlertCircle } from "lucide-react";
import {
  chatCompletion,
  getInferenceProviderConfig,
  simulateContext,
} from "../../lib/tauri";
import { useAppStore } from "../../lib/store";
import type { ChatMessage, InferenceProviderConfig } from "../../lib/types";

interface ChatTurn {
  id: string;
  role: "user" | "assistant";
  content: string;
  pending?: boolean;
  error?: boolean;
  contextIds?: string[];
}

const DEFAULT_TOKEN_BUDGET = 2_000;
const SYSTEM_PROMPT =
  "You are an AI assistant embedded in the user's personal knowledge vault. " +
  "When context snippets from the vault are provided, ground your answer in them and cite memory ids inline as [memory-id]. " +
  "If the context is empty or unrelated, answer from general knowledge but state that no vault context matched. " +
  "Be concise, factual, and preserve the user's language.";

function nanoid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function ChatPanel() {
  const { t } = useTranslation();
  const setChatOpen = useAppStore((s) => s.setChatOpen);

  const [providerConfig, setProviderConfig] =
    useState<InferenceProviderConfig | null>(null);
  const [providerLoaded, setProviderLoaded] = useState(false);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [useVaultContext, setUseVaultContext] = useState(true);

  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    getInferenceProviderConfig()
      .then((cfg) => {
        setProviderConfig(cfg);
        setProviderLoaded(true);
      })
      .catch(() => {
        setProviderConfig(null);
        setProviderLoaded(true);
      });
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [turns]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const providerReady =
    providerConfig?.enabled === true && providerConfig.model.trim().length > 0;

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;
    if (!providerReady) return;

    const userTurn: ChatTurn = {
      id: nanoid(),
      role: "user",
      content: text,
    };
    const pendingTurn: ChatTurn = {
      id: nanoid(),
      role: "assistant",
      content: "",
      pending: true,
    };

    setTurns((prev) => [...prev, userTurn, pendingTurn]);
    setInput("");
    setSending(true);

    try {
      let systemPrompt = SYSTEM_PROMPT;
      let contextIds: string[] = [];

      if (useVaultContext) {
        try {
          const scored = await simulateContext(text, DEFAULT_TOKEN_BUDGET);
          if (scored && scored.length > 0) {
            const blocks = scored
              .slice(0, 8)
              .map((s) => `### [${s.memory_id}] ${s.l0}\n(level: ${s.load_level}, importance: ${s.score.importance.toFixed(2)})`)
              .join("\n\n");
            systemPrompt = `${SYSTEM_PROMPT}\n\n---\nRELEVANT VAULT CONTEXT (${scored.length} memories, ranked):\n${blocks}`;
            contextIds = scored.slice(0, 8).map((s) => s.memory_id);
          }
        } catch {
          // non-fatal — keep plain system prompt
        }
      }

      // Build message history (excluding pending turn)
      const history: ChatMessage[] = [...turns, userTurn].map((turn) => ({
        role: turn.role,
        content: turn.content,
      }));

      const response = await chatCompletion({
        messages: history,
        system_prompt: systemPrompt,
        model: providerConfig?.model ?? null,
      });

      setTurns((prev) =>
        prev.map((turn) =>
          turn.id === pendingTurn.id
            ? {
                ...turn,
                content: response.text,
                pending: false,
                contextIds,
              }
            : turn,
        ),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setTurns((prev) =>
        prev.map((turn) =>
          turn.id === pendingTurn.id
            ? {
                ...turn,
                content: message,
                pending: false,
                error: true,
              }
            : turn,
        ),
      );
    } finally {
      setSending(false);
    }
  }, [input, sending, providerReady, providerConfig, turns, useVaultContext]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const handleClear = () => {
    setTurns([]);
    setInput("");
  };

  return (
    <aside className="flex h-full w-[380px] shrink-0 flex-col border-l border-[color:var(--border)] bg-[color:var(--bg-0)]">
      {/* Header */}
      <div className="flex h-[38px] shrink-0 items-center justify-between border-b border-[color:var(--border)] px-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 text-[color:var(--accent)]" />
          <span className="text-[11px] font-medium uppercase tracking-wider text-[color:var(--text-2)]">
            {t("chat.title")}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleClear}
            className="rounded px-2 py-0.5 text-[10px] uppercase tracking-wider text-[color:var(--text-2)] transition-colors hover:text-[color:var(--text-1)] disabled:opacity-40"
            disabled={turns.length === 0 && !input}
            title={t("chat.clear")}
          >
            {t("chat.clear")}
          </button>
          <button
            onClick={() => setChatOpen(false)}
            className="rounded p-1 text-[color:var(--text-2)] transition-colors hover:bg-[color:var(--bg-2)] hover:text-[color:var(--text-1)]"
            title={t("chat.close")}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Provider status banner */}
      {providerLoaded && !providerReady && (
        <div className="shrink-0 border-b border-[color:var(--border)] bg-[color:var(--bg-1)] px-3 py-2">
          <div className="flex items-start gap-2 text-xs text-[color:var(--text-2)]">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[color:var(--warning,#f59e0b)]" />
            <span>{t("chat.noProvider")}</span>
          </div>
        </div>
      )}

      {/* Messages */}
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto px-3 py-3"
      >
        {turns.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-[color:var(--text-2)]">
            <Sparkles className="h-6 w-6 text-[color:var(--text-2)]/50" />
            <p className="text-sm text-[color:var(--text-1)]">
              {t("chat.empty.title")}
            </p>
            <p className="max-w-[260px] text-xs">
              {t("chat.empty.description")}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {turns.map((turn) => (
              <MessageBubble key={turn.id} turn={turn} />
            ))}
          </div>
        )}
      </div>

      {/* Input */}
      <div className="shrink-0 border-t border-[color:var(--border)] bg-[color:var(--bg-0)] p-3">
        <div className="mb-2 flex items-center justify-between">
          <label className="flex items-center gap-2 text-[11px] text-[color:var(--text-2)]">
            <input
              type="checkbox"
              checked={useVaultContext}
              onChange={(e) => setUseVaultContext(e.target.checked)}
              className="h-3 w-3 accent-[color:var(--accent)]"
            />
            {t("chat.useContext")}
          </label>
          {providerConfig?.model && (
            <span className="font-mono text-[10px] text-[color:var(--text-2)]">
              {providerConfig.model}
            </span>
          )}
        </div>
        <div className="relative rounded-md border border-[color:var(--border)] bg-[color:var(--bg-1)] focus-within:border-[color:var(--accent)]">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t("chat.inputPlaceholder")}
            rows={3}
            disabled={!providerReady}
            className="w-full resize-none bg-transparent px-3 py-2 pr-10 text-sm text-[color:var(--text-0)] placeholder:text-[color:var(--text-2)] focus:outline-none disabled:opacity-50"
          />
          <button
            onClick={() => void handleSend()}
            disabled={sending || !input.trim() || !providerReady}
            className="absolute bottom-2 right-2 flex h-7 w-7 items-center justify-center rounded text-[color:var(--accent)] transition-colors hover:bg-[color:var(--accent-muted)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
            title={t("chat.send")}
          >
            {sending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </button>
        </div>
        <p className="mt-1.5 text-[10px] text-[color:var(--text-2)]">
          {t("chat.hint")}
        </p>
      </div>
    </aside>
  );
}

function MessageBubble({ turn }: { turn: ChatTurn }) {
  const isUser = turn.role === "user";
  return (
    <div
      className={`flex flex-col gap-1 ${isUser ? "items-end" : "items-start"}`}
    >
      <div
        className={[
          "max-w-[90%] rounded-lg px-3 py-2 text-sm",
          isUser
            ? "bg-[color:var(--accent-muted)] text-[color:var(--text-0)]"
            : turn.error
              ? "border border-[color:var(--danger)]/40 bg-[color:var(--danger)]/10 text-[color:var(--text-0)]"
              : "border border-[color:var(--border)] bg-[color:var(--bg-1)] text-[color:var(--text-0)]",
        ].join(" ")}
      >
        {turn.pending ? (
          <div className="flex items-center gap-2 text-[color:var(--text-2)]">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span className="text-xs">…</span>
          </div>
        ) : (
          <p className="whitespace-pre-wrap break-words">{turn.content}</p>
        )}
      </div>
      {!isUser && turn.contextIds && turn.contextIds.length > 0 && (
        <div className="flex flex-wrap gap-1 pl-1">
          {turn.contextIds.map((id) => (
            <span
              key={id}
              className="rounded bg-[color:var(--bg-2)] px-1.5 py-0.5 font-mono text-[9px] text-[color:var(--text-2)]"
            >
              {id}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
