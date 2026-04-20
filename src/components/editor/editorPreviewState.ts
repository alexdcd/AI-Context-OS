import {
  type EditorSelection,
  type EditorState,
  StateEffect,
  StateField,
  type Text,
} from "@codemirror/state";

export const PREVIEW_SETTLE_DELAY_MS = 260;

export const setFrozenPreviewLinesEffect = StateEffect.define<readonly number[] | null>();

export const frozenPreviewLinesField = StateField.define<readonly number[] | null>({
  create: () => null,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setFrozenPreviewLinesEffect)) {
        return effect.value;
      }
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

export function getActivePreviewLineNumbers(state: EditorState, revealSyntaxOnActiveLine: boolean) {
  if (!revealSyntaxOnActiveLine) {
    return [];
  }

  const frozenLines = state.field(frozenPreviewLinesField, false);
  if (frozenLines) {
    return frozenLines;
  }

  if (selectionHasRange(state.selection)) {
    return [];
  }

  return getSelectionHeadLineNumbers(state.selection, state.doc);
}
