import {
  StateEffect,
  StateField,
  type EditorSelection,
  type EditorState,
  type Text,
} from "@codemirror/state";

export const setPreviewSelectionModeEffect = StateEffect.define<boolean>();

export const previewSelectionModeField = StateField.define<boolean>({
  create: () => false,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setPreviewSelectionModeEffect)) {
        return effect.value;
      }
    }

    if (transaction.selection && !selectionHasRange(transaction.state.selection)) {
      return false;
    }

    return value;
  },
});

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

export function isPreviewSelectionMode(state: EditorState) {
  return state.field(previewSelectionModeField, false);
}

export function shouldDisablePreviewDecorations(state: EditorState) {
  return isPreviewSelectionMode(state) || selectionHasRange(state.selection);
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

  if (shouldDisablePreviewDecorations(state)) {
    return [];
  }

  const lineNumbers = new Set<number>();
  for (const range of state.selection.ranges) {
    lineNumbers.add(state.doc.lineAt(range.head).number);
  }

  return Array.from(lineNumbers).sort((left, right) => left - right);
}
