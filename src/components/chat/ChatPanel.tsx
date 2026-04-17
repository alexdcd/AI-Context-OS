import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Send, X, Loader2, Sparkles, AlertCircle } from "lucide-react";
import {
  buildChatContext,
  chatCompletion,
  getInferenceProviderConfig,
  simulateContext,
} from "../../lib/tauri";
import { useAppStore } from "../../lib/store";
import { HybridMarkdownEditor } from "../editor/HybridMarkdownEditor";
import type {
  ChatContextDebug,
  ChatMessage,
  InferenceProviderConfig,
  LoadLevel,
  ScoredMemory,
} from "../../lib/types";

interface ChatTurn {
  id: string;
  role: "user" | "assistant";
  content: string;
  pending?: boolean;
  error?: boolean;
  contextIds?: string[];
  contextDebug?: {
    budget: number;
    promptChars: number;
    tokensUsed?: number;
    memoryCount: number;
    memories: Array<{
      id: string;
      score?: number;
      tokenEstimate?: number;
      loadLevel?: LoadLevel;
    }>;
  };
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

function scoreColor(score?: number): string {
  if (score == null) return "var(--text-2)";
  if (score >= 0.75) return "var(--success)";
  if (score >= 0.45) return "var(--warning)";
  return "var(--text-2)";
}

function buildContextDebug(
  contextIds: string[],
  promptContext: string,
  budget: number,
  scored?: ScoredMemory[],
): ChatTurn["contextDebug"] | undefined {
  if (contextIds.length === 0) return undefined;

  const byId = new Map((scored ?? []).map((memory) => [memory.memory_id, memory]));
  return {
    budget,
    promptChars: promptContext.length,
    memoryCount: contextIds.length,
    memories: contextIds.map((id) => {
      const match = byId.get(id);
      return {
        id,
        score: match?.score.final_score,
        tokenEstimate: match?.token_estimate,
        loadLevel: match?.load_level,
      };
    }),
  };
}

function fromResponseContextDebug(
  debug?: ChatContextDebug | null,
): ChatTurn["contextDebug"] | undefined {
  if (!debug) return undefined;
  return {
    budget: debug.token_budget,
    promptChars: debug.prompt_chars,
    tokensUsed: debug.tokens_used,
    memoryCount: debug.memory_count,
    memories: debug.memories.map((memory) => ({
      id: memory.id,
      score: memory.score ?? undefined,
      tokenEstimate: memory.token_estimate ?? undefined,
      loadLevel: memory.load_level ?? undefined,
    })),
  };
}

function fallbackContextMemories(
  contextIds: string[],
): NonNullable<ChatTurn["contextDebug"]>["memories"] {
  return contextIds.map((id) => ({ id }));
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
      let contextPrompt = "";
      let contextIds: string[] = [];
      let contextDebug: ChatTurn["contextDebug"];
      const shouldUseVaultContext = useVaultContext;

      if (shouldUseVaultContext) {
        try {
          const chatContext = await buildChatContext(text, DEFAULT_TOKEN_BUDGET);
          if (chatContext.prompt_context.trim()) {
            contextPrompt = chatContext.prompt_context;
            contextIds = chatContext.memory_ids;
            contextDebug = buildContextDebug(
              contextIds,
              contextPrompt,
              DEFAULT_TOKEN_BUDGET,
            );
          }
        } catch {
          // Backend fallback can still resolve vault context when enabled.
        }
      }

      // Build message history (excluding pending turn)
      const history: ChatMessage[] = [...turns, userTurn].map((turn) => ({
        role: turn.role,
        content: turn.content,
      }));

      const response = await chatCompletion({
        messages: history,
        system_prompt: SYSTEM_PROMPT,
        include_vault_context: shouldUseVaultContext,
        context_prompt: contextPrompt || null,
        context_memory_ids: contextIds,
        model: providerConfig?.model ?? null,
      });
      const resolvedContextIds = Array.isArray(response.context_memory_ids)
        ? response.context_memory_ids
        : contextIds;
      const baseContextDebug =
        fromResponseContextDebug(response.context_debug) ??
        buildContextDebug(
          resolvedContextIds,
          contextPrompt,
          DEFAULT_TOKEN_BUDGET,
        ) ??
        contextDebug;

      setTurns((prev) =>
        prev.map((turn) =>
          turn.id === pendingTurn.id
              ? {
                  ...turn,
                  content: response.text,
                  pending: false,
                  contextIds: resolvedContextIds,
                  contextDebug: baseContextDebug,
                }
              : turn,
        ),
      );

      if (
        shouldUseVaultContext &&
        resolvedContextIds.length > 0 &&
        !response.context_debug
      ) {
        void simulateContext(text, DEFAULT_TOKEN_BUDGET)
          .then((scored) => {
            const enrichedDebug = buildContextDebug(
              resolvedContextIds,
              contextPrompt,
              DEFAULT_TOKEN_BUDGET,
              scored,
            );
            setTurns((prev) =>
              prev.map((turn) =>
                turn.id === pendingTurn.id
                  ? {
                      ...turn,
                      contextDebug: enrichedDebug,
                    }
                  : turn,
              ),
            );
          })
          .catch(() => {
            // Keep basic debug info if score enrichment fails.
          });
      }
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
        ) : isUser ? (
          <p className="whitespace-pre-wrap break-words">{turn.content}</p>
        ) : (
          <div className="chat-md break-words">
            <HybridMarkdownEditor
              content={turn.content}
              onChange={() => {}}
              editable={false}
            />
          </div>
        )}
      </div>
      {!isUser && ((turn.contextIds && turn.contextIds.length > 0) || turn.contextDebug) && (
        <div className="w-full max-w-[90%] rounded-md border border-[color:var(--border)] bg-[color:var(--bg-1)]/70 px-2 py-1.5">
          <div className="mb-1 font-mono text-[10px] font-medium uppercase tracking-wide text-[color:var(--text-2)]">
            Context Debug
          </div>
          {turn.contextDebug && (
            <div className="mb-1 font-mono text-[10px] text-[color:var(--text-2)]">
              {turn.contextDebug.memoryCount} memorias · {turn.contextDebug.promptChars} chars de `context_prompt`
              {turn.contextDebug.tokensUsed != null && turn.contextDebug.tokensUsed > 0 && ` · ${turn.contextDebug.tokensUsed}t usados`}
              {turn.contextDebug.budget > 0 && ` · budget ${turn.contextDebug.budget}`}
            </div>
          )}
          <div className="flex flex-wrap gap-1">
          {(turn.contextDebug?.memories ?? fallbackContextMemories(turn.contextIds ?? [])).map((memory) => (
            <span
              key={memory.id}
              className="rounded bg-[color:var(--bg-2)] px-1.5 py-0.5 font-mono text-[10px]"
              style={{ color: scoreColor(memory.score) }}
            >
              {memory.id}
              {memory.score != null && ` · ${memory.score.toFixed(2)}`}
              {memory.tokenEstimate != null && ` · ${memory.tokenEstimate}t`}
              {memory.loadLevel && ` · ${memory.loadLevel.toUpperCase()}`}
            </span>
          ))}
          </div>
        </div>
      )}
    </div>
  );
}
