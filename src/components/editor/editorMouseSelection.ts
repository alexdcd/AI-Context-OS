import type { EditorState } from "@codemirror/state";

export function isTaskCheckboxHitOffset(clickOffset: number) {
  return clickOffset <= 28;
}

export function getDocumentWordRangeAtPosition(state: EditorState, pos: number) {
  const word = state.wordAt(pos);
  if (!word || word.empty) {
    return null;
  }

  return { from: word.from, to: word.to };
}
