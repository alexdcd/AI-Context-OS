import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { clsx } from "clsx";

interface Props {
  content: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  className?: string;
  editable?: boolean;
}

/**
 * Hybrid Markdown editor — Typora / Obsidian style.
 *
 * - **Not editing**: rendered markdown preview (headings, lists, bold, etc.)
 * - **Click to edit**: full textarea with raw markdown (Enter, undo, selection all work)
 * - **Click away**: back to rendered view + auto-save via onBlur
 *
 * Shortcuts: Cmd+B bold · Cmd+I italic · Cmd+E code · Tab indent
 */
export function HybridMarkdownEditor({
  content,
  onChange,
  onBlur,
  placeholder,
  className,
  editable = true,
}: Props) {
  const [isEditing, setIsEditing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  /* ── Auto-grow textarea to fit content ── */
  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0";
    el.style.height = el.scrollHeight + "px";
  }, []);

  useEffect(() => {
    if (isEditing) autoResize();
  }, [content, isEditing, autoResize]);

  /* ── Focus textarea when entering edit mode ── */
  useEffect(() => {
    if (isEditing && textareaRef.current) {
      const el = textareaRef.current;
      el.focus();
      const len = el.value.length;
      el.setSelectionRange(len, len);
      autoResize();
    }
  }, [isEditing, autoResize]);

  /* ── Keyboard shortcuts ── */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const el = e.currentTarget;
      const isMod = e.metaKey || e.ctrlKey;

      if (isMod && !e.altKey) {
        const key = e.key.toLowerCase();
        if (key === "b") {
          e.preventDefault();
          wrapSelection(el, "**");
          onChange(el.value);
          return;
        }
        if (key === "i") {
          e.preventDefault();
          wrapSelection(el, "*");
          onChange(el.value);
          return;
        }
        if (key === "e") {
          e.preventDefault();
          wrapSelection(el, "`");
          onChange(el.value);
          return;
        }
        if (key === "x" && e.shiftKey) {
          e.preventDefault();
          wrapSelection(el, "~~");
          onChange(el.value);
          return;
        }
      }

      /* Tab → insert 2 spaces */
      if (e.key === "Tab") {
        e.preventDefault();
        const start = el.selectionStart;
        const end = el.selectionEnd;
        const before = el.value.slice(0, start);
        const after = el.value.slice(end);
        el.value = before + "  " + after;
        el.selectionStart = start + 2;
        el.selectionEnd = start + 2;
        onChange(el.value);
      }
    },
    [onChange],
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      onChange(e.target.value);
    },
    [onChange],
  );

  const handleBlur = useCallback(() => {
    setIsEditing(false);
    onBlur?.();
  }, [onBlur]);

  const enterEditMode = useCallback(() => {
    if (editable) setIsEditing(true);
  }, [editable]);

  /* ═══ Edit mode: full textarea ═══ */
  if (isEditing && editable) {
    return (
      <div data-hybrid-editor className={clsx("tiptap", className)}>
        <textarea
          ref={textareaRef}
          value={content}
          onChange={handleChange}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          onInput={autoResize}
          placeholder={placeholder}
          spellCheck={false}
          className={clsx(
            "w-full resize-none overflow-hidden bg-transparent",
            "font-mono text-[0.9375rem] leading-[1.55]",
            "text-[color:var(--text-1)] placeholder:text-[color:var(--text-2)]/40",
            "outline-none",
          )}
          style={{ minHeight: 170 }}
        />
      </div>
    );
  }

  /* ═══ Read mode: rendered markdown preview ═══ */
  return (
    <div
      data-hybrid-editor
      className={clsx("tiptap", editable && "cursor-text", className)}
      onClick={enterEditMode}
    >
      {content.trim() ? (
        <RenderedContent content={content} />
      ) : (
        <p className="text-[color:var(--text-2)]/40" style={{ minHeight: 170 }}>
          {placeholder ?? "Type here..."}
        </p>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Rendered markdown view (display only — inherits .tiptap CSS)
   ═══════════════════════════════════════════════════════════════════════════ */

function RenderedContent({ content }: { content: string }) {
  const blocks = useMemo(() => splitIntoBlocks(content), [content]);

  return (
    <>
      {blocks.map((block, idx) => {
        const trimmed = block.trim();
        if (!trimmed) return <div key={idx} className="min-h-[1.2em]" />;
        return (
          <div key={idx}>
            <BlockContent markdown={trimmed} />
          </div>
        );
      })}
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Block content renderer
   ═══════════════════════════════════════════════════════════════════════════ */

function BlockContent({ markdown }: { markdown: string }) {
  if (/^---+$/.test(markdown) || /^\*\*\*+$/.test(markdown)) {
    return <hr className="my-2 border-[color:var(--border)]" />;
  }

  if (markdown.startsWith("```")) {
    const lines = markdown.split("\n");
    const hasClose =
      lines.length > 1 && lines[lines.length - 1].startsWith("```");
    const inner = lines.slice(1, hasClose ? -1 : undefined);
    return (
      <pre>
        <code>{inner.join("\n")}</code>
      </pre>
    );
  }

  const h3 = markdown.match(/^###\s+(.*)/);
  if (h3) return <h3>{renderInline(h3[1])}</h3>;

  const h2 = markdown.match(/^##\s+(.*)/);
  if (h2) return <h2>{renderInline(h2[1])}</h2>;

  const h1 = markdown.match(/^#\s+(.*)/);
  if (h1) return <h1>{renderInline(h1[1])}</h1>;

  const bq = markdown.match(/^>\s?(.*)/);
  if (bq) {
    return (
      <blockquote>
        <p>{renderInline(bq[1])}</p>
      </blockquote>
    );
  }

  const task = markdown.match(/^-\s*\[([ xX])\]\s+(.*)/);
  if (task) {
    const checked = task[1] !== " ";
    return (
      <div className="flex items-start gap-2">
        <span
          className={clsx(
            "mt-0.5 text-sm",
            checked
              ? "text-[color:var(--success)]"
              : "text-[color:var(--text-2)]",
          )}
        >
          {checked ? "☑" : "☐"}
        </span>
        <span
          className={clsx(
            "text-sm",
            checked && "line-through text-[color:var(--text-2)]",
          )}
        >
          {renderInline(task[2])}
        </span>
      </div>
    );
  }

  const ul = markdown.match(/^[-*]\s+(.*)/);
  if (ul) {
    return (
      <ul>
        <li>{renderInline(ul[1])}</li>
      </ul>
    );
  }

  const ol = markdown.match(/^(\d+)\.\s+(.*)/);
  if (ol) {
    return (
      <ol start={Number(ol[1])}>
        <li>{renderInline(ol[2])}</li>
      </ol>
    );
  }

  return <p>{renderInline(markdown)}</p>;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Inline markdown rendering
   ═══════════════════════════════════════════════════════════════════════════ */

function renderInline(
  text: string,
): (string | React.ReactElement)[] {
  const parts: (string | React.ReactElement)[] = [];
  const regex =
    /(\*\*(.+?)\*\*|__(.+?)__|~~(.+?)~~|\*(.+?)\*|_(.+?)_|`(.+?)`)/g;
  let cursor = 0;
  let key = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > cursor) {
      parts.push(text.slice(cursor, match.index));
    }
    if (match[2] || match[3]) {
      parts.push(<strong key={key++}>{match[2] || match[3]}</strong>);
    } else if (match[4]) {
      parts.push(
        <s key={key++} className="text-[color:var(--text-2)]">
          {match[4]}
        </s>,
      );
    } else if (match[5] || match[6]) {
      parts.push(<em key={key++}>{match[5] || match[6]}</em>);
    } else if (match[7]) {
      parts.push(<code key={key++}>{match[7]}</code>);
    }
    cursor = regex.lastIndex;
  }

  if (cursor < text.length) {
    parts.push(text.slice(cursor));
  }
  if (parts.length === 0) return [text];
  return parts;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Block splitting (for rendering only — editing uses raw textarea)
   ═══════════════════════════════════════════════════════════════════════════ */

function splitIntoBlocks(content: string): string[] {
  if (!content) return [""];
  const lines = content.split("\n");
  const blocks: string[] = [];
  let buffer = "";
  let inCodeBlock = false;
  let codeBuffer = "";

  const flushBuffer = () => {
    if (buffer.length > 0) {
      blocks.push(buffer);
      buffer = "";
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      if (inCodeBlock) {
        codeBuffer += "\n" + line;
        blocks.push(codeBuffer);
        codeBuffer = "";
        inCodeBlock = false;
      } else {
        flushBuffer();
        inCodeBlock = true;
        codeBuffer = line;
      }
      continue;
    }

    if (inCodeBlock) {
      codeBuffer += "\n" + line;
      continue;
    }

    const isBlockStart =
      /^#{1,6}\s/.test(trimmed) ||
      /^[-*]\s/.test(trimmed) ||
      /^>\s?/.test(trimmed) ||
      /^\d+\.\s/.test(trimmed) ||
      /^---+$/.test(trimmed) ||
      /^\*\*\*+$/.test(trimmed);

    if (isBlockStart) {
      flushBuffer();
      blocks.push(line);
    } else if (trimmed === "") {
      flushBuffer();
      blocks.push("");
    } else {
      buffer += (buffer ? "\n" : "") + line;
    }
  }

  flushBuffer();
  if (inCodeBlock && codeBuffer) {
    blocks.push(codeBuffer);
  }
  if (blocks.length === 0) return [""];
  return blocks;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Textarea helpers
   ═══════════════════════════════════════════════════════════════════════════ */

function wrapSelection(el: HTMLTextAreaElement, marker: string) {
  const start = el.selectionStart;
  const end = el.selectionEnd;
  const text = el.value;
  const selected = text.slice(start, end);
  el.value = text.slice(0, start) + marker + selected + marker + text.slice(end);
  el.selectionStart = start + marker.length;
  el.selectionEnd = end + marker.length;
}
