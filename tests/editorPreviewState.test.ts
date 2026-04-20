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

test("getActivePreviewLineNumbers includes every line covered by a multi-line range", () => {
  const state = EditorState.create({
    doc: "# heading\nplain\n[[memory]]\n",
    selection: EditorSelection.range(0, 17),
  });

  assert.equal(selectionHasRange(state.selection), true);
  // Range 0..17 spans: line 1 ("# heading"), line 2 ("plain"), line 3
  // starts at offset 16 so the "to" hits the beginning of the third line.
  assert.deepEqual(getActivePreviewLineNumbers(state, true), [1, 2, 3]);
});

test("getActivePreviewLineNumbers deduplicates lines across multiple ranges", () => {
  const state = EditorState.create({
    doc: "alpha\nbeta\ngamma\ndelta\n",
    selection: EditorSelection.create(
      [EditorSelection.range(0, 10), EditorSelection.range(6, 16)],
      1,
    ),
    extensions: [EditorState.allowMultipleSelections.of(true)],
  });

  assert.deepEqual(getActivePreviewLineNumbers(state, true), [1, 2, 3]);
});
