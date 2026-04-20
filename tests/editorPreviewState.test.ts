import test from "node:test";
import assert from "node:assert/strict";
import { EditorSelection, EditorState } from "@codemirror/state";
import {
  frozenPreviewLinesField,
  getActivePreviewLineNumbers,
  getSelectionHeadLineNumbers,
  setFrozenPreviewLinesEffect,
} from "../src/components/editor/editorPreviewState.ts";

test("getSelectionHeadLineNumbers uses selection heads instead of full ranges", () => {
  const state = EditorState.create({
    doc: "alpha\nbeta\ngamma\n",
    selection: EditorSelection.create(
      [EditorSelection.range(0, 7), EditorSelection.range(11, 12)],
      1,
    ),
    extensions: [EditorState.allowMultipleSelections.of(true)],
  });

  assert.deepEqual(getSelectionHeadLineNumbers(state.selection, state.doc), [2, 3]);
});

test("getActivePreviewLineNumbers keeps the previously revealed lines while frozen", () => {
  const baseState = EditorState.create({
    doc: "# heading\nplain\n[[memory]]\n",
    selection: EditorSelection.cursor(0),
    extensions: [frozenPreviewLinesField],
  });
  const frozenState = baseState.update({
    effects: setFrozenPreviewLinesEffect.of([1]),
    selection: EditorSelection.cursor(12),
  }).state;

  assert.deepEqual(getActivePreviewLineNumbers(frozenState, true), [1]);
});

test("getActivePreviewLineNumbers falls back to the current selection once the freeze clears", () => {
  const baseState = EditorState.create({
    doc: "# heading\nplain\n[[memory]]\n",
    selection: EditorSelection.cursor(0),
    extensions: [frozenPreviewLinesField],
  });
  const frozenState = baseState.update({
    effects: setFrozenPreviewLinesEffect.of([1]),
    selection: EditorSelection.cursor(12),
  }).state;
  const settledState = frozenState.update({
    effects: setFrozenPreviewLinesEffect.of(null),
  }).state;

  assert.deepEqual(getActivePreviewLineNumbers(settledState, true), [2]);
});
