import React, { useState, useRef, useEffect, useCallback, useMemo, type KeyboardEvent } from "react";
import { clsx } from "clsx";

interface Props {
  content: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

/**
 * Hybrid Markdown editor — Logseq/Obsidian style.
 * Each block renders as formatted markdown by default.
 * Clicking a block reveals raw markdown for editing.
 */
export function HybridMarkdownEditor({ content, onChange, placeholder, className }: Props) {
  const blocks = useMemo(() => splitIntoBlocks(content), [content]);
  const [focusedIdx, setFocusedIdx] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  const commitEdit = useCallback(
    (idx: number, newText: string) => {
      const updated = blocks.map((b, i) => (i === idx ? newText : b));
      onChange(updated.join("\n"));
    },
    [blocks, onChange],
  );

  const handleBlockClick = useCallback(
    (idx: number) => {
      if (focusedIdx === idx) return;
      // Commit previous
      if (focusedIdx !== null) {
        commitEdit(focusedIdx, editValue);
      }
      setFocusedIdx(idx);
      setEditValue(blocks[idx] ?? "");
    },
    [focusedIdx, editValue, blocks, commitEdit],
  );

  const handleBlur = useCallback(() => {
    if (focusedIdx !== null) {
      commitEdit(focusedIdx, editValue);
      setFocusedIdx(null);
    }
  }, [focusedIdx, editValue, commitEdit]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>, idx: number) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        // Commit current block, insert new block after, focus it
        const updatedBlocks = [...blocks];
        updatedBlocks[idx] = editValue;
        updatedBlocks.splice(idx + 1, 0, "");
        onChange(updatedBlocks.join("\n"));
        setFocusedIdx(idx + 1);
        setEditValue("");
      }

      if (e.key === "Backspace" && editValue === "" && blocks.length > 1) {
        e.preventDefault();
        const updatedBlocks = blocks.filter((_, i) => i !== idx);
        onChange(updatedBlocks.join("\n"));
        const prevIdx = Math.max(0, idx - 1);
        setFocusedIdx(prevIdx);
        setEditValue(updatedBlocks[prevIdx] ?? "");
      }

      if (e.key === "ArrowUp" && idx > 0) {
        const textarea = e.currentTarget;
        if (textarea.selectionStart === 0) {
          e.preventDefault();
          commitEdit(idx, editValue);
          const prevIdx = idx - 1;
          setFocusedIdx(prevIdx);
          setEditValue(blocks[prevIdx] ?? "");
        }
      }

      if (e.key === "ArrowDown" && idx < blocks.length - 1) {
        const textarea = e.currentTarget;
        if (textarea.selectionStart === textarea.value.length) {
          e.preventDefault();
          commitEdit(idx, editValue);
          const nextIdx = idx + 1;
          setFocusedIdx(nextIdx);
          setEditValue(blocks[nextIdx] ?? "");
        }
      }

      if (e.key === "Escape") {
        e.preventDefault();
        handleBlur();
      }
    },
    [editValue, blocks, onChange, commitEdit, handleBlur],
  );

  if (blocks.length === 0 || (blocks.length === 1 && blocks[0] === "")) {
    return (
      <div
        className={clsx("min-h-[170px] cursor-text", className)}
        onClick={() => {
          if (blocks.length === 0) {
            onChange("");
          }
          setFocusedIdx(0);
          setEditValue(blocks[0] ?? "");
        }}
      >
        <p className="py-1 text-sm text-[color:var(--text-2)]/50">
          {placeholder ?? "Escribe aquí..."}
        </p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className={clsx("min-h-[170px]", className)}>
      {blocks.map((block, idx) => (
        <div key={`block-${idx}`}>
          {focusedIdx === idx ? (
            <EditableBlock
              value={editValue}
              onChange={setEditValue}
              onBlur={handleBlur}
              onKeyDown={(e) => handleKeyDown(e, idx)}
            />
          ) : (
            <RenderedBlock
              markdown={block}
              onClick={() => handleBlockClick(idx)}
            />
          )}
        </div>
      ))}
    </div>
  );
}

/* ─── Sub-components ─── */

function EditableBlock({
  value,
  onChange,
  onBlur,
  onKeyDown,
}: {
  value: string;
  onChange: (v: string) => void;
  onBlur: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.focus();
      // Place cursor at end
      const len = ref.current.value.length;
      ref.current.setSelectionRange(len, len);
    }
  }, []);

  // Auto-resize
  useEffect(() => {
    if (ref.current) {
      ref.current.style.height = "auto";
      ref.current.style.height = `${ref.current.scrollHeight}px`;
    }
  }, [value]);

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
      spellCheck={false}
      rows={1}
      className="w-full resize-none rounded border border-[color:var(--accent)]/30 bg-[color:var(--bg-2)] px-2 py-1 font-mono text-sm leading-relaxed text-[color:var(--text-2)] outline-none focus:border-[color:var(--accent)]/60"
    />
  );
}

function RenderedBlock({
  markdown,
  onClick,
}: {
  markdown: string;
  onClick: () => void;
}) {
  const trimmed = markdown.trim();

  if (!trimmed) {
    return (
      <div
        className="min-h-[1.5em] cursor-text rounded px-2 py-1 transition-colors hover:bg-[color:var(--bg-2)]/50"
        onClick={onClick}
      />
    );
  }

  return (
    <div
      className="cursor-text rounded px-2 py-1 transition-colors hover:bg-[color:var(--bg-2)]/50"
      onClick={onClick}
    >
      <BlockContent markdown={trimmed} />
    </div>
  );
}

function BlockContent({ markdown }: { markdown: string }) {
  // Heading
  const h3 = markdown.match(/^###\s+(.*)/);
  if (h3) return <h3 className="text-base font-semibold text-[color:var(--text-0)]">{renderInline(h3[1])}</h3>;

  const h2 = markdown.match(/^##\s+(.*)/);
  if (h2) return <h2 className="text-lg font-semibold text-[color:var(--text-0)]">{renderInline(h2[1])}</h2>;

  const h1 = markdown.match(/^#\s+(.*)/);
  if (h1) return <h1 className="text-xl font-bold text-[color:var(--text-0)]">{renderInline(h1[1])}</h1>;

  // Blockquote
  const bq = markdown.match(/^>\s?(.*)/);
  if (bq) {
    return (
      <blockquote className="border-l-2 border-[color:var(--accent)] pl-3 text-sm italic text-[color:var(--text-1)]">
        {renderInline(bq[1])}
      </blockquote>
    );
  }

  // Unordered list item
  const ul = markdown.match(/^[-*]\s+(.*)/);
  if (ul) {
    return (
      <div className="flex gap-2 text-sm text-[color:var(--text-1)]">
        <span className="text-[color:var(--text-2)]">•</span>
        <span>{renderInline(ul[1])}</span>
      </div>
    );
  }

  // Ordered list item
  const ol = markdown.match(/^(\d+)\.\s+(.*)/);
  if (ol) {
    return (
      <div className="flex gap-2 text-sm text-[color:var(--text-1)]">
        <span className="text-[color:var(--text-2)]">{ol[1]}.</span>
        <span>{renderInline(ol[2])}</span>
      </div>
    );
  }

  // Checkbox task
  const task = markdown.match(/^-\s*\[([ xX])\]\s+(.*)/);
  if (task) {
    const checked = task[1] !== " ";
    return (
      <div className="flex items-start gap-2 text-sm text-[color:var(--text-1)]">
        <span className={clsx("mt-0.5", checked ? "text-[color:var(--success)]" : "text-[color:var(--text-2)]")}>
          {checked ? "☑" : "☐"}
        </span>
        <span className={clsx(checked && "line-through text-[color:var(--text-2)]")}>
          {renderInline(task[2])}
        </span>
      </div>
    );
  }

  // Code block (single-line fenced)
  if (markdown.startsWith("```")) {
    return (
      <pre className="rounded bg-[color:var(--bg-2)] px-3 py-2 font-mono text-xs text-[color:var(--text-1)]">
        <code>{markdown.replace(/^```\w*\n?/, "").replace(/\n?```$/, "")}</code>
      </pre>
    );
  }

  // Horizontal rule
  if (/^---+$/.test(markdown) || /^\*\*\*+$/.test(markdown)) {
    return <hr className="my-1 border-[color:var(--border)]" />;
  }

  // Regular paragraph
  return <p className="text-sm leading-relaxed text-[color:var(--text-1)]">{renderInline(markdown)}</p>;
}

/* ─── Inline markdown rendering ─── */

function renderInline(text: string): (string | React.ReactElement)[] {
  const parts: (string | React.ReactElement)[] = [];
  // Combined regex for inline formatting
  const regex = /(\*\*(.+?)\*\*|__(.+?)__|\*(.+?)\*|_(.+?)_|~~(.+?)~~|`(.+?)`)/g;
  let cursor = 0;
  let key = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    // Text before match
    if (match.index > cursor) {
      parts.push(text.slice(cursor, match.index));
    }

    if (match[2] || match[3]) {
      // Bold
      parts.push(
        <strong key={key++} className="font-semibold text-[color:var(--text-0)]">
          {match[2] || match[3]}
        </strong>,
      );
    } else if (match[4] || match[5]) {
      // Italic
      parts.push(
        <em key={key++} className="italic">
          {match[4] || match[5]}
        </em>,
      );
    } else if (match[6]) {
      // Strikethrough
      parts.push(
        <s key={key++} className="text-[color:var(--text-2)]">
          {match[6]}
        </s>,
      );
    } else if (match[7]) {
      // Inline code
      parts.push(
        <code
          key={key++}
          className="rounded bg-[color:var(--bg-2)] px-1 py-0.5 font-mono text-[12px] text-[color:var(--accent)]"
        >
          {match[7]}
        </code>,
      );
    }

    cursor = regex.lastIndex;
  }

  // Remaining text
  if (cursor < text.length) {
    parts.push(text.slice(cursor));
  }

  if (parts.length === 0) return [text];
  return parts;
}

/* ─── Block splitting ─── */

function splitIntoBlocks(content: string): string[] {
  if (!content) return [""];
  // Split by double newline (paragraph) or single newline for list items/headings
  const lines = content.split("\n");
  const blocks: string[] = [];
  let buffer = "";

  for (const line of lines) {
    const trimmed = line.trim();

    // These always start a new block
    const isBlockStart =
      trimmed.startsWith("#") ||
      trimmed.startsWith("-") ||
      trimmed.startsWith("*") ||
      trimmed.startsWith(">") ||
      trimmed.startsWith("```") ||
      /^\d+\.\s/.test(trimmed) ||
      trimmed === "---" ||
      trimmed === "***";

    if (isBlockStart) {
      if (buffer.trim()) {
        blocks.push(buffer.trim());
      }
      blocks.push(line);
      buffer = "";
    } else if (trimmed === "") {
      if (buffer.trim()) {
        blocks.push(buffer.trim());
      }
      buffer = "";
    } else {
      // Continuation of paragraph
      buffer += (buffer ? "\n" : "") + line;
    }
  }

  if (buffer.trim()) {
    blocks.push(buffer.trim());
  }

  if (blocks.length === 0) return [""];
  return blocks;
}
