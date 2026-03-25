import { useEffect } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  List,
  ListOrdered,
  Quote,
  Redo2,
  Strikethrough,
  Undo2,
} from "lucide-react";
import { clsx } from "clsx";

interface Props {
  content: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

interface ToolbarButton {
  label: string;
  icon: typeof Bold;
  action: (editor: Editor) => void;
  isActive?: (editor: Editor) => boolean;
  isDisabled?: (editor: Editor) => boolean;
}

/**
 * Markdown-oriented TipTap editor with a compact toolbar inspired by block editors.
 * Content is serialized back to Markdown-compatible plain text.
 */
export function TipTapEditor({ content, onChange, placeholder, className }: Props) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        codeBlock: {
          HTMLAttributes: { class: "bg-zinc-800 rounded-lg p-3 font-mono text-sm" },
        },
        code: { HTMLAttributes: { class: "bg-zinc-800 rounded px-1 py-0.5 font-mono text-sm" } },
      }),
      Placeholder.configure({
        placeholder: placeholder ?? "Start writing...",
        emptyEditorClass: "is-editor-empty",
      }),
    ],
    editorProps: {
      attributes: {
        class: clsx(
          "tiptap obs-editor-content min-h-[170px] max-w-none focus:outline-none",
          className,
        ),
      },
    },
    content: markdownToHtml(content),
    onUpdate: ({ editor: nextEditor }) => {
      const text = editorToMarkdown(nextEditor);
      onChange(text);
    },
  });

  useEffect(() => {
    if (editor && !editor.isFocused) {
      const currentText = editorToMarkdown(editor);
      if (currentText !== content) {
        editor.commands.setContent(markdownToHtml(content));
      }
    }
  }, [content, editor]);

  if (!editor) {
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[color:var(--bg-1)]/60 p-3 text-sm text-[color:var(--text-2)]">
        Cargando editor...
      </div>
    );
  }

  const toolbarButtons: ToolbarButton[] = [
    {
      label: "Undo",
      icon: Undo2,
      action: (ed) => ed.chain().focus().undo().run(),
      isDisabled: (ed) => !ed.can().undo(),
    },
    {
      label: "Redo",
      icon: Redo2,
      action: (ed) => ed.chain().focus().redo().run(),
      isDisabled: (ed) => !ed.can().redo(),
    },
    {
      label: "H1",
      icon: Heading1,
      action: (ed) => ed.chain().focus().toggleHeading({ level: 1 }).run(),
      isActive: (ed) => ed.isActive("heading", { level: 1 }),
    },
    {
      label: "H2",
      icon: Heading2,
      action: (ed) => ed.chain().focus().toggleHeading({ level: 2 }).run(),
      isActive: (ed) => ed.isActive("heading", { level: 2 }),
    },
    {
      label: "H3",
      icon: Heading3,
      action: (ed) => ed.chain().focus().toggleHeading({ level: 3 }).run(),
      isActive: (ed) => ed.isActive("heading", { level: 3 }),
    },
    {
      label: "Bold",
      icon: Bold,
      action: (ed) => ed.chain().focus().toggleBold().run(),
      isActive: (ed) => ed.isActive("bold"),
      isDisabled: (ed) => !ed.can().chain().focus().toggleBold().run(),
    },
    {
      label: "Italic",
      icon: Italic,
      action: (ed) => ed.chain().focus().toggleItalic().run(),
      isActive: (ed) => ed.isActive("italic"),
      isDisabled: (ed) => !ed.can().chain().focus().toggleItalic().run(),
    },
    {
      label: "Strike",
      icon: Strikethrough,
      action: (ed) => ed.chain().focus().toggleStrike().run(),
      isActive: (ed) => ed.isActive("strike"),
      isDisabled: (ed) => !ed.can().chain().focus().toggleStrike().run(),
    },
    {
      label: "Inline code",
      icon: Code,
      action: (ed) => ed.chain().focus().toggleCode().run(),
      isActive: (ed) => ed.isActive("code"),
      isDisabled: (ed) => !ed.can().chain().focus().toggleCode().run(),
    },
    {
      label: "Bullet list",
      icon: List,
      action: (ed) => ed.chain().focus().toggleBulletList().run(),
      isActive: (ed) => ed.isActive("bulletList"),
    },
    {
      label: "Ordered list",
      icon: ListOrdered,
      action: (ed) => ed.chain().focus().toggleOrderedList().run(),
      isActive: (ed) => ed.isActive("orderedList"),
    },
    {
      label: "Quote",
      icon: Quote,
      action: (ed) => ed.chain().focus().toggleBlockquote().run(),
      isActive: (ed) => ed.isActive("blockquote"),
    },
  ];

  return (
    <div className="obs-editor-shell overflow-hidden">
      <div className="flex flex-wrap items-center gap-1 border-b border-[var(--border)] bg-[color:var(--bg-1)]/80 px-3 py-2">
        {toolbarButtons.map((button) => {
          const active = button.isActive?.(editor) ?? false;
          const disabled = button.isDisabled?.(editor) ?? false;
          return (
            <button
              key={button.label}
              type="button"
              onClick={() => button.action(editor)}
              disabled={disabled}
              className={clsx(
                "inline-flex h-8 w-8 items-center justify-center rounded-md border transition-colors",
                active
                  ? "border-sky-400/40 bg-sky-500/20 text-sky-200"
                  : "border-transparent bg-[color:var(--bg-2)]/55 text-[color:var(--text-1)] hover:border-[var(--border)] hover:text-[color:var(--text-0)]",
                disabled && "cursor-not-allowed opacity-45",
              )}
              title={button.label}
            >
              <button.icon className="h-4 w-4" />
            </button>
          );
        })}
        <span className="ml-auto text-xs text-[color:var(--text-2)]">/ para comandos</span>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}

/**
 * Extract markdown from the TipTap editor using its JSON document structure.
 * This avoids innerHTML/XSS concerns by using TipTap's typed API.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function editorToMarkdown(editor: any): string {
  const json = editor.getJSON();
  return jsonToMarkdown(json).trim();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function jsonToMarkdown(node: any): string {
  if (!node) return "";

  if (node.type === "text") {
    let text = node.text ?? "";
    if (node.marks) {
      for (const mark of node.marks) {
        if (mark.type === "bold") text = `**${text}**`;
        if (mark.type === "italic") text = `*${text}*`;
        if (mark.type === "strike") text = `~~${text}~~`;
        if (mark.type === "code") text = `\`${text}\``;
      }
    }
    return text;
  }

  const children = (node.content ?? [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((child: any) => jsonToMarkdown(child))
    .join("");

  switch (node.type) {
    case "doc":
      return children;
    case "paragraph":
      return `${children}\n\n`;
    case "heading": {
      const level = node.attrs?.level ?? 1;
      const prefix = "#".repeat(level);
      return `${prefix} ${children}\n\n`;
    }
    case "bulletList":
      return (
        (node.content ?? [])
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((li: any) => `- ${jsonToMarkdown(li).trim()}`)
          .join("\n") + "\n\n"
      );
    case "orderedList":
      return (
        (node.content ?? [])
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((li: any, i: number) => `${i + 1}. ${jsonToMarkdown(li).trim()}`)
          .join("\n") + "\n\n"
      );
    case "listItem":
      return children;
    case "codeBlock":
      return `\`\`\`\n${children}\n\`\`\`\n\n`;
    case "blockquote":
      return (
        children
          .split("\n")
          .filter(Boolean)
          .map((line: string) => `> ${line}`)
          .join("\n") + "\n\n"
      );
    case "hardBreak":
      return "\n";
    default:
      return children;
  }
}

/**
 * Basic Markdown to HTML conversion for TipTap initialization.
 * Handles headings, bold, italic, strike, code blocks, inline code, lists, blockquotes, and paragraphs.
 */
function markdownToHtml(md: string): string {
  if (!md.trim()) return "";

  const lines = md.split("\n");
  const result: string[] = [];
  let inCodeBlock = false;
  let codeBuffer: string[] = [];
  let inList = false;
  let listType = "";

  for (const line of lines) {
    if (line.startsWith("```")) {
      if (inCodeBlock) {
        result.push(`<pre><code>${escapeHtml(codeBuffer.join("\n"))}</code></pre>`);
        codeBuffer = [];
        inCodeBlock = false;
      } else {
        if (inList) {
          result.push(listType === "ul" ? "</ul>" : "</ol>");
          inList = false;
        }
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeBuffer.push(line);
      continue;
    }

    if (!line.trim()) {
      if (inList) {
        result.push(listType === "ul" ? "</ul>" : "</ol>");
        inList = false;
      }
      continue;
    }

    const quote = line.match(/^>\s?(.*)/);
    if (quote) {
      if (inList) {
        result.push(listType === "ul" ? "</ul>" : "</ol>");
        inList = false;
      }
      result.push(`<blockquote><p>${inlineFormat(quote[1])}</p></blockquote>`);
      continue;
    }

    const h3 = line.match(/^###\s+(.*)/);
    if (h3) {
      if (inList) {
        result.push(listType === "ul" ? "</ul>" : "</ol>");
        inList = false;
      }
      result.push(`<h3>${inlineFormat(h3[1])}</h3>`);
      continue;
    }
    const h2 = line.match(/^##\s+(.*)/);
    if (h2) {
      if (inList) {
        result.push(listType === "ul" ? "</ul>" : "</ol>");
        inList = false;
      }
      result.push(`<h2>${inlineFormat(h2[1])}</h2>`);
      continue;
    }
    const h1 = line.match(/^#\s+(.*)/);
    if (h1) {
      if (inList) {
        result.push(listType === "ul" ? "</ul>" : "</ol>");
        inList = false;
      }
      result.push(`<h1>${inlineFormat(h1[1])}</h1>`);
      continue;
    }

    const ul = line.match(/^[-*]\s+(.*)/);
    if (ul) {
      if (!inList || listType !== "ul") {
        if (inList) result.push(listType === "ul" ? "</ul>" : "</ol>");
        result.push("<ul>");
        inList = true;
        listType = "ul";
      }
      result.push(`<li>${inlineFormat(ul[1])}</li>`);
      continue;
    }

    const ol = line.match(/^\d+\.\s+(.*)/);
    if (ol) {
      if (!inList || listType !== "ol") {
        if (inList) result.push(listType === "ul" ? "</ul>" : "</ol>");
        result.push("<ol>");
        inList = true;
        listType = "ol";
      }
      result.push(`<li>${inlineFormat(ol[1])}</li>`);
      continue;
    }

    if (inList) {
      result.push(listType === "ul" ? "</ul>" : "</ol>");
      inList = false;
    }

    result.push(`<p>${inlineFormat(line)}</p>`);
  }

  if (inList) result.push(listType === "ul" ? "</ul>" : "</ol>");
  if (inCodeBlock) {
    result.push(`<pre><code>${escapeHtml(codeBuffer.join("\n"))}</code></pre>`);
  }

  return result.join("");
}

function inlineFormat(text: string): string {
  const escaped = escapeHtml(text);
  return escaped
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/__(.+?)__/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/_(.+?)_/g, "<em>$1</em>")
    .replace(/~~(.+?)~~/g, "<s>$1</s>")
    .replace(/`(.+?)`/g, "<code>$1</code>");
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
