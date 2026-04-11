import React, { useRef, useEffect, useCallback } from "react";
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
 * Always-editable markdown editor.
 * Uncontrolled auto-growing textarea — Enter, undo, selection, # all work natively.
 * Cmd+B bold · Cmd+I italic · Cmd+E code · Cmd+Shift+X strike · Tab indent
 */
export function HybridMarkdownEditor({
  content,
  onChange,
  onBlur,
  placeholder,
  className,
  editable = true,
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  /* ── Auto-grow to fit content ── */
  const resize = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0";
    el.style.height = Math.max(el.scrollHeight, 170) + "px";
  }, []);

  // Resize on mount
  useEffect(resize, [resize]);

  /* ── Sync value from parent when it changes externally ── */
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Only update if textarea is NOT focused (avoid clobbering user edits)
    if (document.activeElement !== el && el.value !== content) {
      el.value = content;
      resize();
    }
  }, [content, resize]);

  /* ── Emit changes to parent on every input ── */
  const handleInput = useCallback(() => {
    resize();
    if (ref.current) onChange(ref.current.value);
  }, [onChange, resize]);

  /* ── Keyboard shortcuts (work directly on DOM — no React conflict) ── */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const el = e.currentTarget;
      const isMod = e.metaKey || e.ctrlKey;

      if (isMod && !e.altKey) {
        const key = e.key.toLowerCase();
        if (key === "b") { e.preventDefault(); wrap(el, "**"); onChange(el.value); return; }
        if (key === "i") { e.preventDefault(); wrap(el, "*"); onChange(el.value); return; }
        if (key === "e") { e.preventDefault(); wrap(el, "`"); onChange(el.value); return; }
        if (key === "x" && e.shiftKey) { e.preventDefault(); wrap(el, "~~"); onChange(el.value); return; }
      }

      if (e.key === "Tab") {
        e.preventDefault();
        el.setRangeText("  ", el.selectionStart, el.selectionEnd, "end");
        onChange(el.value);
      }
    },
    [onChange],
  );

  const handleBlur = useCallback(() => {
    if (ref.current) onChange(ref.current.value);
    onBlur?.();
  }, [onChange, onBlur]);

  return (
    <textarea
      ref={ref}
      defaultValue={content}
      onInput={handleInput}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      readOnly={!editable}
      placeholder={placeholder}
      spellCheck={false}
      className={clsx(
        "w-full resize-none overflow-hidden border-0 bg-transparent p-0",
        "text-[0.9375rem] leading-[1.65] tracking-[-0.01em]",
        "text-[color:var(--text-0)] placeholder:text-[color:var(--text-2)]/40",
        "outline-none ring-0 focus:border-0 focus:outline-none focus:ring-0",
        className,
      )}
      style={{ minHeight: 170 }}
    />
  );
}

function wrap(el: HTMLTextAreaElement, marker: string) {
  const start = el.selectionStart;
  const end = el.selectionEnd;
  const selected = el.value.slice(start, end);
  el.setRangeText(marker + selected + marker, start, end, "select");
  el.selectionStart = start + marker.length;
  el.selectionEnd = end + marker.length;
}
