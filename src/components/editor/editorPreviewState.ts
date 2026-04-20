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

export function getActivePreviewLineNumbers(state: EditorState, revealSyntaxOnActiveLine: boolean) {
  if (!revealSyntaxOnActiveLine) {
    return [];
  }

  // Base active line purely on the main anchor to ensure stability
  // during mouse drags, preventing layout jumping & selection glitches.
  return [state.doc.lineAt(state.selection.main.anchor).number];
}
