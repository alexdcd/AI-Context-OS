import test from "node:test";
import assert from "node:assert/strict";
import { isTaskCheckboxHitOffset } from "../src/components/editor/editorMouseSelection.ts";

test("isTaskCheckboxHitOffset reserves the left checkbox hit area", () => {
  assert.equal(isTaskCheckboxHitOffset(12), true);
  assert.equal(isTaskCheckboxHitOffset(28), true);
  assert.equal(isTaskCheckboxHitOffset(29), false);
});
