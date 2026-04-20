import test from "node:test";
import assert from "node:assert/strict";
import { EditorSelection, EditorState, Transaction } from "@codemirror/state";
import {
  activePreviewLineNumbersChanged,
  getActivePreviewLineNumbers,
  getSelectionHeadLineNumbers,
  selectionHasRange,
  shouldRefreshActivePreviewLines,
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

test("activePreviewLineNumbersChanged tracks caret line transitions", () => {
  const startState = EditorState.create({
    doc: "alpha\nbeta\n",
    selection: EditorSelection.cursor(0),
  });
  const sameLineState = startState.update({
    selection: EditorSelection.cursor(3),
  }).state;
  const nextLineState = startState.update({
    selection: EditorSelection.cursor(7),
  }).state;

  assert.equal(activePreviewLineNumbersChanged(startState, sameLineState, true), false);
  assert.equal(activePreviewLineNumbersChanged(startState, nextLineState, true), true);
});

test("activePreviewLineNumbersChanged tracks transitions into selected ranges", () => {
  const startState = EditorState.create({
    doc: "alpha\nbeta\n",
    selection: EditorSelection.cursor(0),
  });
  const rangeState = startState.update({
    selection: EditorSelection.range(0, 7),
  }).state;

  assert.equal(getActivePreviewLineNumbers(rangeState, true).length, 0);
  assert.equal(activePreviewLineNumbersChanged(startState, rangeState, true), true);
});

test("shouldRefreshActivePreviewLines ignores pointer selection updates", () => {
  const startState = EditorState.create({
    doc: "alpha\nbeta\n",
    selection: EditorSelection.cursor(0),
  });
  const transaction = startState.update({
    selection: EditorSelection.cursor(7),
    annotations: Transaction.userEvent.of("select.pointer"),
  });

  assert.equal(
    shouldRefreshActivePreviewLines(
      {
        selectionSet: true,
        startState,
        state: transaction.state,
        transactions: [transaction],
      },
      true,
    ),
    false,
  );
});

test("shouldRefreshActivePreviewLines allows non-pointer caret line changes", () => {
  const startState = EditorState.create({
    doc: "alpha\nbeta\n",
    selection: EditorSelection.cursor(0),
  });
  const transaction = startState.update({
    selection: EditorSelection.cursor(7),
    annotations: Transaction.userEvent.of("select"),
  });

  assert.equal(
    shouldRefreshActivePreviewLines(
      {
        selectionSet: true,
        startState,
        state: transaction.state,
        transactions: [transaction],
      },
      true,
    ),
    true,
  );
});
