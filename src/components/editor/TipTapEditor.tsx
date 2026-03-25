import { useEffect } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { clsx } from "clsx";

interface Props {
  content: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

/**
 * Minimal TipTap editor — no toolbar, markdown shortcuts only.
 * Content is serialized to Markdown via TipTap's JSON API.
 */
export function TipTapEditor({
  content,
  onChange,
  placeholder,
  className,
}: Props) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
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
      <div className="rounded-md border border-[var(--border)] bg-[color:var(--bg-1)] p-3 text-sm text-[color:var(--text-2)]">
        Loading...
      </div>
    );
  }

  return <EditorContent editor={editor} />;
}

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
