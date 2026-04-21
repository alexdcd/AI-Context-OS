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
export const listSourceMarkerMark = Decoration.mark({ class: "cm-list-source-marker" });

export const hiddenSyntaxStyle = {
  color: "transparent !important",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important",
  fontSize: "1px !important",
  letterSpacing: "-1ch !important",
} as const;

/**
 * Replace widgets are safe in richer read-only previews, but they break the
 * browser-to-document mapping in editable live preview because the DOM no
 * longer mirrors the source text. Keep them out of editable surfaces and off
 * active lines.
 */
export function shouldRenderReplacePreviewWidget(editable: boolean, lineIsActive: boolean) {
  return !editable && !lineIsActive;
}

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

export function isInsideMarkdownListItem(node: { parent: { name: string; parent: any } | null }) {
  let current = node.parent;
  while (current) {
    if (current.name === "ListItem") {
      return true;
    }
    current = current.parent;
  }
  return false;
}

function listItemHasTask(node: { parent: { name: string; firstChild?: any; parent: any } | null }) {
  let current = node.parent;
  while (current && current.name !== "ListItem") {
    current = current.parent;
  }
  if (!current) return false;

  for (let child = current.firstChild; child; child = child.nextSibling) {
    if (child.name === "Task") {
      return true;
    }
  }

  return false;
}

export function shouldKeepListMarkerVisible(
  nodeName: string,
  node: { parent: { name: string; firstChild?: any; parent: any } | null },
) {
  return nodeName === "ListMark"
    && isInsideMarkdownListItem(node)
    && !listItemHasTask(node);
}

export function getVisibleListMarkerDecoration(
  nodeName: string,
  node: { parent: { name: string; firstChild?: any; parent: any } | null },
) {
  if (!shouldKeepListMarkerVisible(nodeName, node)) {
    return null;
  }

  return listSourceMarkerMark;
}
