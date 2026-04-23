import test from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import {
  getDocumentWordRangeAtPosition,
  isTaskCheckboxHitOffset,
} from "../src/components/editor/editorMouseSelection.ts";

test("isTaskCheckboxHitOffset reserves the left checkbox hit area", () => {
  assert.equal(isTaskCheckboxHitOffset(12), true);
  assert.equal(isTaskCheckboxHitOffset(28), true);
  assert.equal(isTaskCheckboxHitOffset(29), false);
});

test("getDocumentWordRangeAtPosition selects words inside bold markdown", () => {
  const doc = "**uno dos tres**";
  const state = EditorState.create({ doc });

  assert.deepEqual(
    getDocumentWordRangeAtPosition(state, doc.indexOf("dos") + 1),
    { from: 6, to: 9 },
  );
  assert.deepEqual(
    getDocumentWordRangeAtPosition(state, doc.indexOf("tres") + 1),
    { from: 10, to: 14 },
  );
});

test("getDocumentWordRangeAtPosition ignores markdown marker positions", () => {
  const state = EditorState.create({ doc: "**uno**" });

  assert.equal(getDocumentWordRangeAtPosition(state, 0), null);
});
