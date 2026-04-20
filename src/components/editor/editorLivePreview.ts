import { Decoration } from "@codemirror/view";

export const ALWAYS_HIDDEN_MARKERS = [
  "QuoteMark",
  "HorizontalRule",
  "ListMark",
  "TaskMarker",
  "TableDelimiter",
] as const;

export const ACTIVE_LINE_HIDDEN_MARKERS = [
  "HeaderMark",
  "EmphasisMark",
  "StrongEmphasisMark",
  "StrikethroughMark",
  "CodeMark",
  "LinkMark",
  "CodeInfo",
] as const;

export const hiddenSyntaxMark = Decoration.mark({ class: "cm-hidden-syntax" });

export function shouldHideMarkdownNode(nodeName: string, lineIsActive: boolean) {
  if (ALWAYS_HIDDEN_MARKERS.includes(nodeName as (typeof ALWAYS_HIDDEN_MARKERS)[number])) {
    return true;
  }

  if (lineIsActive) {
    return false;
  }

  return ACTIVE_LINE_HIDDEN_MARKERS.includes(
    nodeName as (typeof ACTIVE_LINE_HIDDEN_MARKERS)[number],
  );
}
