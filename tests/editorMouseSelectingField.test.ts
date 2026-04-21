import test from "node:test";
import assert from "node:assert/strict";
import { EditorSelection, EditorState, Transaction } from "@codemirror/state";
import {
  isMouseSelecting,
  mouseSelectingField,
  setMouseSelecting,
  shouldRefreshSensitivePreviewDecorations,
} from "../src/components/editor/editorMouseSelectingField.ts";

test("mouseSelectingField can be activated and deactivated", () => {
  const state = EditorState.create({
    doc: "alpha\nbeta\n",
    extensions: [mouseSelectingField],
  });

  const activeState = state.update({
    effects: setMouseSelecting.of(true),
  }).state;
  const inactiveState = activeState.update({
    effects: setMouseSelecting.of(false),
  }).state;

  assert.equal(isMouseSelecting(state), false);
  assert.equal(isMouseSelecting(activeState), true);
  assert.equal(isMouseSelecting(inactiveState), false);
});

test("sensitive preview refreshes are frozen while mouse selection is active", () => {
  const startState = EditorState.create({
    doc: "alpha\nbeta\n",
    selection: EditorSelection.cursor(0),
    extensions: [mouseSelectingField],
  }).update({
    effects: setMouseSelecting.of(true),
  }).state;

  const transaction = startState.update({
    selection: EditorSelection.cursor(7),
    annotations: Transaction.userEvent.of("select"),
  });

  assert.equal(
    shouldRefreshSensitivePreviewDecorations(
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

test("sensitive preview refreshes once after mouse selection finishes", () => {
  const startState = EditorState.create({
    doc: "alpha\nbeta\n",
    selection: EditorSelection.range(0, 7),
    extensions: [mouseSelectingField],
  }).update({
    effects: setMouseSelecting.of(true),
  }).state;

  const transaction = startState.update({
    effects: setMouseSelecting.of(false),
  });

  assert.equal(
    shouldRefreshSensitivePreviewDecorations(
      {
        selectionSet: false,
        startState,
        state: transaction.state,
        transactions: [transaction],
      },
      true,
    ),
    true,
  );
});
