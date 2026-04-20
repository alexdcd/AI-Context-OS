import {
  type EditorSelection,
  type EditorState,
  type Text,
} from "@codemirror/state";

export function getSelectionHeadLineNumbers(selection: EditorSelection, doc: Text) {
  const lineNumbers = new Set<number>();

  for (const range of selection.ranges) {
    lineNumbers.add(doc.lineAt(range.head).number);
  }

  return Array.from(lineNumbers).sort((left, right) => left - right);
}

export function selectionHasRange(selection: EditorSelection) {
  return selection.ranges.some((range) => !range.empty);
}

/**
 * Return the lines whose raw markdown markers should be revealed. Empty
 * selections reveal the caret line. Non-empty selections reveal nothing: the
 * live-preview DOM must stay stable while text is selected, otherwise releasing
 * the mouse can repaint hidden markers into the highlighted range.
 */
export function getActivePreviewLineNumbers(
  state: EditorState,
  revealSyntaxOnActiveLine: boolean,
) {
  if (!revealSyntaxOnActiveLine) {
    return [];
  }

  if (selectionHasRange(state.selection)) {
    return [];
  }

  const lineNumbers = new Set<number>();
  for (const range of state.selection.ranges) {
    lineNumbers.add(state.doc.lineAt(range.head).number);
  }

  return Array.from(lineNumbers).sort((left, right) => left - right);
}
