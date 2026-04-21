import { EditorSelection, type Text } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

type ChangeSpec = { from: number; to?: number; insert?: string };

function getLinePrefixChange(line: { from: number; text: string }, prefix: string): ChangeSpec {
  const headingMatch = line.text.match(/^#{1,6}\s+/);
  const bulletMatch = line.text.match(/^(\s*)([-*+])\s+/);
  const orderedMatch = line.text.match(/^(\s*)\d+\.\s+/);
  const taskMatch = line.text.match(/^(\s*)-\s\[[ xX]\]\s+(?:\[#(?:[ABCabc])\]\s+)?/);
  const quoteMatch = line.text.match(/^>\s?/);

  if (prefix.startsWith("#")) {
    if (headingMatch && line.text.startsWith(prefix)) {
      return { from: line.from, to: line.from + prefix.length, insert: "" };
    }
    if (headingMatch) {
      return { from: line.from, to: line.from + headingMatch[0].length, insert: prefix };
    }
    return { from: line.from, insert: prefix };
  }

  if (prefix === "> ") {
    if (quoteMatch) {
      return { from: line.from, to: line.from + quoteMatch[0].length, insert: "" };
    }
    return { from: line.from, insert: prefix };
  }

  if (prefix === "- ") {
    if (taskMatch) {
      return { from: line.from, to: line.from + taskMatch[0].length, insert: prefix };
    }
    if (bulletMatch) {
      return { from: line.from, to: line.from + bulletMatch[0].length, insert: "" };
    }
    if (orderedMatch) {
      return { from: line.from, to: line.from + orderedMatch[0].length, insert: prefix };
    }
    return { from: line.from, insert: prefix };
  }

  if (prefix === "1. ") {
    if (orderedMatch) {
      return { from: line.from, to: line.from + orderedMatch[0].length, insert: "" };
    }
    if (bulletMatch) {
      return { from: line.from, to: line.from + bulletMatch[0].length, insert: prefix };
    }
    return { from: line.from, insert: prefix };
  }

  if (prefix.startsWith("- [ ]")) {
    if (taskMatch) {
      return { from: line.from, to: line.from + taskMatch[0].length, insert: "" };
    }
    if (bulletMatch) {
      return { from: line.from, to: line.from + bulletMatch[0].length, insert: prefix };
    }
    return { from: line.from, insert: prefix };
  }

  return { from: line.from, insert: prefix };
}

export function normalizeInlineRange(doc: Text, from: number, to: number) {
  let nextFrom = from;
  let nextTo = to;

  while (nextTo > nextFrom) {
    const char = doc.sliceString(nextTo - 1, nextTo);
    if (char !== "\n" && char !== "\r") break;
    nextTo -= 1;
  }

  const line = doc.lineAt(nextFrom);
  if (nextFrom === line.from && nextTo >= line.to) {
    const prefixMatch = line.text.match(
      /^(\s*(?:[-*+]\s|\d+\.\s|- \[[ xX]\]\s+(?:\[#(?:[ABCabc])\]\s+)?|>\s))/,
    );
    if (prefixMatch) {
      nextFrom += prefixMatch[0].length;
    }
  }

  return nextTo < nextFrom ? { from, to } : { from: nextFrom, to: nextTo };
}

export function normalizeMarkdownInlineRange(doc: Text, from: number, to: number) {
  const normalized = normalizeInlineRange(doc, from, to);
  let nextFrom = normalized.from;
  let nextTo = normalized.to;

  while (nextFrom < nextTo && /[ \t]/.test(doc.sliceString(nextFrom, nextFrom + 1))) {
    nextFrom += 1;
  }

  while (nextTo > nextFrom && /[ \t]/.test(doc.sliceString(nextTo - 1, nextTo))) {
    nextTo -= 1;
  }

  return nextTo < nextFrom ? normalized : { from: nextFrom, to: nextTo };
}

export function applyLinePrefixToggle(view: EditorView, prefix: string) {
  const { state } = view;
  const lineNumbers = new Set<number>();

  for (const range of state.selection.ranges) {
    const startLine = state.doc.lineAt(range.from).number;
    const endLine = state.doc.lineAt(range.to).number;
    for (let lineNumber = startLine; lineNumber <= endLine; lineNumber += 1) {
      lineNumbers.add(lineNumber);
    }
  }

  const changes = Array.from(lineNumbers)
    .sort((a, b) => a - b)
    .map((lineNumber) => getLinePrefixChange(state.doc.line(lineNumber), prefix));

  if (changes.length === 0) return;

  const mainSelection = state.selection.main;
  const mainLine = state.doc.lineAt(mainSelection.from);
  const mainLineChange = getLinePrefixChange(mainLine, prefix);
  const shouldMoveMainCursor =
    mainSelection.empty &&
    mainSelection.from === mainLine.from &&
    Boolean(mainLineChange.insert);
  const nextMainCursor = shouldMoveMainCursor
    ? mainLineChange.from + (mainLineChange.insert?.length ?? 0)
    : null;

  view.dispatch({
    changes,
    selection:
      nextMainCursor === null
        ? EditorSelection.create(
            state.selection.ranges.map((range) => range.map(state.changes(changes))),
            state.selection.mainIndex,
          )
        : EditorSelection.cursor(nextMainCursor),
    scrollIntoView: true,
    userEvent: "input",
  });
  view.focus();
}

export function insertMarkdownLink(view: EditorView, textPlaceholder: string) {
  const { state } = view;
  const range = state.selection.main;
  const selected = state.sliceDoc(range.from, range.to) || textPlaceholder;
  const insert = `[${selected}](url)`;

  view.dispatch({
    changes: { from: range.from, to: range.to, insert },
    selection: EditorSelection.range(range.from + selected.length + 3, range.from + selected.length + 6),
    scrollIntoView: true,
    userEvent: "input",
  });
  view.focus();
}

export function getFencedCodeBlockInsertion(
  doc: Text,
  from: number,
  to: number,
  selectedText: string,
) {
  const startLine = doc.lineAt(from);
  const endLine = doc.lineAt(to);
  const prefix = from === startLine.from ? "" : "\n";
  const suffix = to === endLine.to ? "" : "\n";
  const body = selectedText.replace(/^\n+|\n+$/g, "");
  const insert = `${prefix}\`\`\`\n${body}\n\`\`\`${suffix}`;
  const bodyFrom = from + prefix.length + 4;
  const bodyTo = bodyFrom + body.length;

  return { insert, bodyFrom, bodyTo };
}

export function insertFencedCodeBlock(view: EditorView) {
  const { state } = view;
  const range = state.selection.main;
  const selected = state.sliceDoc(range.from, range.to);
  const { insert, bodyFrom, bodyTo } = getFencedCodeBlockInsertion(
    state.doc,
    range.from,
    range.to,
    selected,
  );
  const selection = bodyFrom === bodyTo
    ? EditorSelection.cursor(bodyFrom)
    : EditorSelection.range(bodyFrom, bodyTo);

  view.dispatch({
    changes: { from: range.from, to: range.to, insert },
    selection,
    scrollIntoView: true,
    userEvent: "input",
  });
  view.focus();
}
