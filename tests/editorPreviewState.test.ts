import test from "node:test";
import assert from "node:assert/strict";
import { EditorSelection, EditorState } from "@codemirror/state";
import {
  getActivePreviewLineNumbers,
  getSelectionHeadLineNumbers,
  isPreviewSelectionMode,
  previewSelectionModeField,
  selectionHasRange,
  setPreviewSelectionModeEffect,
  shouldDisablePreviewDecorations,
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

test("preview selection mode disables preview decorations before a range exists", () => {
  const state = EditorState.create({
    doc: "- **alpha**\n",
    selection: EditorSelection.cursor(0),
    extensions: [previewSelectionModeField],
  });

  const rawSelectionState = state.update({
    effects: setPreviewSelectionModeEffect.of(true),
  }).state;

  assert.equal(isPreviewSelectionMode(rawSelectionState), true);
  assert.equal(shouldDisablePreviewDecorations(rawSelectionState), true);
  assert.deepEqual(getActivePreviewLineNumbers(rawSelectionState, true), []);
});

test("preview selection mode clears when the selection is collapsed", () => {
  const state = EditorState.create({
    doc: "alpha\nbeta\n",
    selection: EditorSelection.range(0, 5),
    extensions: [previewSelectionModeField],
  }).update({
    effects: setPreviewSelectionModeEffect.of(true),
  }).state;

  const collapsedState = state.update({
    selection: EditorSelection.cursor(7),
  }).state;

  assert.equal(isPreviewSelectionMode(collapsedState), false);
  assert.equal(shouldDisablePreviewDecorations(collapsedState), false);
  assert.deepEqual(getActivePreviewLineNumbers(collapsedState, true), [2]);
});
