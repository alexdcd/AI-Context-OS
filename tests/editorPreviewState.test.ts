import test from "node:test";
import assert from "node:assert/strict";
import { EditorSelection, EditorState } from "@codemirror/state";
import {
  getActivePreviewLineNumbers,
  getSelectionHeadLineNumbers,
  selectionHasRange,
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

test("getActivePreviewLineNumbers returns the caret line for empty selections", () => {
  const state = EditorState.create({
    doc: "# heading\nplain\n[[memory]]\n",
    selection: EditorSelection.cursor(12),
  });

  assert.deepEqual(getActivePreviewLineNumbers(state, true), [2]);
});

test("getActivePreviewLineNumbers returns an empty list when reveal-on-active is disabled", () => {
  const state = EditorState.create({
    doc: "# heading\nplain\n",
    selection: EditorSelection.cursor(0),
  });

  assert.deepEqual(getActivePreviewLineNumbers(state, false), []);
});

test("getActivePreviewLineNumbers hides syntax reveal while a range is selected", () => {
  const state = EditorState.create({
    doc: "# heading\nplain\n[[memory]]\n",
    selection: EditorSelection.range(0, 17),
  });

  assert.equal(selectionHasRange(state.selection), true);
  assert.deepEqual(getActivePreviewLineNumbers(state, true), []);
});

test("getActivePreviewLineNumbers reveals multiple caret lines without selected ranges", () => {
  const state = EditorState.create({
    doc: "alpha\nbeta\ngamma\ndelta\n",
    selection: EditorSelection.create(
      [EditorSelection.cursor(0), EditorSelection.cursor(12)],
      1,
    ),
    extensions: [EditorState.allowMultipleSelections.of(true)],
  });

  assert.deepEqual(getActivePreviewLineNumbers(state, true), [1, 3]);
});
