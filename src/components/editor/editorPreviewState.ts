import {
  StateEffect,
  type EditorSelection,
  type EditorState,
  type Text,
} from "@codemirror/state";

/**
 * Emitted after the user commits a mouse-driven selection (on `mouseup`), so
 * the live-preview plugins can refresh their decorations without having to
 * rebuild them on every intermediate `selectionSet` tick during the drag.
 */
export const commitLivePreviewEffect = StateEffect.define<null>();

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
 * Return every line that currently participates in the selection. For empty
 * ranges we surface just the caret line; for non-empty ranges we surface the
 * full span so that every line the user is selecting keeps its raw markdown
 * markers visible and therefore preserves the 1:1 mapping between the DOM
 * geometry and the document offsets. Without this, the hidden markers on
 * non-active lines desynchronise `posAtCoords` and the native browser
 * selection ends up pointing to the wrong characters.
 */
export function getActivePreviewLineNumbers(
  state: EditorState,
  revealSyntaxOnActiveLine: boolean,
) {
  if (!revealSyntaxOnActiveLine) {
    return [];
  }

  const lineNumbers = new Set<number>();
  for (const range of state.selection.ranges) {
    if (range.empty) {
      lineNumbers.add(state.doc.lineAt(range.head).number);
      continue;
    }

    const fromLine = state.doc.lineAt(range.from).number;
    const toLine = state.doc.lineAt(range.to).number;
    for (let line = fromLine; line <= toLine; line += 1) {
      lineNumbers.add(line);
    }
  }

  return Array.from(lineNumbers).sort((left, right) => left - right);
}
