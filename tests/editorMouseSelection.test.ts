import test from "node:test";
import assert from "node:assert/strict";
import {
  hasStructuralSelectionLineClass,
  isTaskCheckboxHitOffset,
  shouldUseStructuralMouseSelection,
} from "../src/components/editor/editorMouseSelection.ts";

test("hasStructuralSelectionLineClass matches list, ordered, and task lines", () => {
  assert.equal(hasStructuralSelectionLineClass("cm-line cm-bullet-item cm-list-depth-1"), true);
  assert.equal(hasStructuralSelectionLineClass("cm-line cm-ordered-item"), true);
  assert.equal(hasStructuralSelectionLineClass("cm-line cm-task-item cm-task-checked"), true);
  assert.equal(hasStructuralSelectionLineClass("cm-line cm-blockquote"), false);
});

test("isTaskCheckboxHitOffset reserves the left checkbox hit area", () => {
  assert.equal(isTaskCheckboxHitOffset(12), true);
  assert.equal(isTaskCheckboxHitOffset(28), true);
  assert.equal(isTaskCheckboxHitOffset(29), false);
});

test("shouldUseStructuralMouseSelection only activates on plain single-click gestures", () => {
  const baseGesture = {
    button: 0,
    detail: 1,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
  };

  assert.equal(
    shouldUseStructuralMouseSelection(baseGesture, "cm-line cm-bullet-item", 40),
    true,
  );
  assert.equal(
    shouldUseStructuralMouseSelection(baseGesture, "cm-line cm-task-item", 12),
    false,
  );
  assert.equal(
    shouldUseStructuralMouseSelection({ ...baseGesture, detail: 2 }, "cm-line cm-bullet-item", 40),
    false,
  );
  assert.equal(
    shouldUseStructuralMouseSelection({ ...baseGesture, shiftKey: true }, "cm-line cm-bullet-item", 40),
    false,
  );
  assert.equal(
    shouldUseStructuralMouseSelection(baseGesture, "cm-line cm-paragraph", 40),
    false,
  );
});
