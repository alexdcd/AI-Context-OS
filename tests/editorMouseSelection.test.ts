import test from "node:test";
import assert from "node:assert/strict";
import {
  getTripleClickSelectionRange,
  isPlainPrimaryMouseGesture,
  isStructuralMarkdownLine,
  isTaskCheckboxHitOffset,
  shouldUseTripleClickLineSelection,
} from "../src/components/editor/editorMouseSelection.ts";

function createDoc(text: string) {
  const lines = text.split("\n");
  const starts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1;
  }

  return {
    lines: lines.length,
    line(number: number) {
      const text = lines[number - 1];
      const from = starts[number - 1];
      return { from, to: from + text.length, text, number };
    },
    lineAt(pos: number) {
      let index = 0;
      for (let i = 0; i < starts.length; i += 1) {
        if (starts[i] <= pos) index = i;
      }
      return this.line(index + 1);
    },
  };
}

test("isStructuralMarkdownLine matches markdown block boundaries", () => {
  assert.equal(isStructuralMarkdownLine("- **+2,000 suscriptores**"), true);
  assert.equal(isStructuralMarkdownLine("1. Ordered item"), true);
  assert.equal(isStructuralMarkdownLine("> quote"), true);
  assert.equal(isStructuralMarkdownLine("## Heading"), true);
  assert.equal(isStructuralMarkdownLine("| Table | Row |"), true);
  assert.equal(isStructuralMarkdownLine("Plain paragraph text"), false);
});

test("isTaskCheckboxHitOffset reserves the left checkbox hit area", () => {
  assert.equal(isTaskCheckboxHitOffset(12), true);
  assert.equal(isTaskCheckboxHitOffset(28), true);
  assert.equal(isTaskCheckboxHitOffset(29), false);
});

test("shouldUseTripleClickLineSelection only activates on plain triple-click gestures", () => {
  const baseGesture = {
    button: 0,
    detail: 3,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
  };

  assert.equal(isPlainPrimaryMouseGesture(baseGesture), true);
  assert.equal(shouldUseTripleClickLineSelection(baseGesture), true);
  assert.equal(shouldUseTripleClickLineSelection({ ...baseGesture, detail: 2 }), false);
  assert.equal(shouldUseTripleClickLineSelection({ ...baseGesture, shiftKey: true }), false);
  assert.equal(shouldUseTripleClickLineSelection({ ...baseGesture, button: 1 }), false);
});

test("getTripleClickSelectionRange selects structural lines exactly", () => {
  const doc = createDoc([
    "intro paragraph",
    "- **+2,000 suscriptores** en el canal",
    "next paragraph",
  ].join("\n"));

  assert.deepEqual(getTripleClickSelectionRange(doc, doc.line(2).from + 8), {
    from: doc.line(2).from,
    to: doc.line(2).to,
  });
});

test("getTripleClickSelectionRange expands plain paragraphs between structural lines", () => {
  const doc = createDoc([
    "- list boundary",
    "plain paragraph one",
    "plain paragraph two",
    "",
    "after blank",
  ].join("\n"));

  assert.deepEqual(getTripleClickSelectionRange(doc, doc.line(3).from + 6), {
    from: doc.line(2).from,
    to: doc.line(3).to,
  });
});
