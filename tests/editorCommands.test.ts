import test from "node:test";
import assert from "node:assert/strict";
import { Text } from "@codemirror/state";
import {
  getFencedCodeBlockInsertion,
  getToggleMarkChange,
  normalizeMarkdownInlineRange,
} from "../src/components/editor/editorCommands.ts";

function applyChanges(text: string, changes: any[]) {
  return [...changes]
    .sort((left, right) => right.from - left.from)
    .reduce(
      (next, change) =>
        next.slice(0, change.from) + (change.insert ?? "") + next.slice(change.to ?? change.from),
      text,
    );
}

test("markdown inline range trims surrounding spaces before adding marks", () => {
  const doc = Text.of([" texto "]);

  assert.deepEqual(normalizeMarkdownInlineRange(doc, 0, 7), { from: 1, to: 6 });
});

test("markdown inline range skips list prefix and trims item text spaces", () => {
  const doc = Text.of(["-  texto "]);

  assert.deepEqual(normalizeMarkdownInlineRange(doc, 0, 9), { from: 3, to: 8 });
});

test("toggle mark removes wrappers around selected bold text", () => {
  const doc = Text.of(["**texto**"]);
  const result = getToggleMarkChange(doc, 2, 7, "**");

  assert.deepEqual(result.changes, [
    { from: 0, to: 2 },
    { from: 7, to: 9 },
  ]);
});

test("toggle mark removes wrappers included in the selection", () => {
  const doc = Text.of(["**texto**"]);
  const result = getToggleMarkChange(doc, 0, 9, "**");

  assert.deepEqual(result.changes, [
    { from: 0, to: 2 },
    { from: 7, to: 9 },
  ]);
});

test("toggle bold splits an enclosing bold span for a middle selection", () => {
  const text = "**uno dos tres cuatro**";
  const doc = Text.of([text]);
  const from = text.indexOf("dos");
  const result = getToggleMarkChange(doc, from, from + "dos".length, "**");

  assert.equal(applyChanges(text, result.changes), "**uno** dos **tres cuatro**");
});

test("toggle bold splits an enclosing bold span at the start", () => {
  const text = "**uno dos tres**";
  const doc = Text.of([text]);
  const from = text.indexOf("uno");
  const result = getToggleMarkChange(doc, from, from + "uno".length, "**");

  assert.equal(applyChanges(text, result.changes), "uno **dos tres**");
});

test("toggle bold splits an enclosing bold span at the end", () => {
  const text = "**uno dos tres**";
  const doc = Text.of([text]);
  const from = text.indexOf("tres");
  const result = getToggleMarkChange(doc, from, from + "tres".length, "**");

  assert.equal(applyChanges(text, result.changes), "**uno dos** tres");
});

test("toggle bold wraps plain text between separate bold spans", () => {
  const text = "**uno** dos **tres**";
  const doc = Text.of([text]);
  const from = text.indexOf("dos");
  const result = getToggleMarkChange(doc, from, from + "dos".length, "**");

  assert.deepEqual(result.changes, [
    { from, insert: "**" },
    { from: from + "dos".length, insert: "**" },
  ]);
});

test("toggle mark wraps selected italic text", () => {
  const doc = Text.of(["texto"]);
  const result = getToggleMarkChange(doc, 0, 5, "*");

  assert.deepEqual(result.changes, [
    { from: 0, insert: "*" },
    { from: 5, insert: "*" },
  ]);
});

test("toggle mark removes selected italic wrappers", () => {
  const doc = Text.of(["*texto*"]);
  const result = getToggleMarkChange(doc, 0, 7, "*");

  assert.deepEqual(result.changes, [
    { from: 0, to: 1 },
    { from: 6, to: 7 },
  ]);
});

test("toggle mark handles inline code wrappers", () => {
  const doc = Text.of(["`texto`"]);
  const result = getToggleMarkChange(doc, 1, 6, "`");

  assert.deepEqual(result.changes, [
    { from: 0, to: 1 },
    { from: 6, to: 7 },
  ]);
});

test("toggle mark handles strikethrough wrappers", () => {
  const doc = Text.of(["~~texto~~"]);
  const result = getToggleMarkChange(doc, 2, 7, "~~");

  assert.deepEqual(result.changes, [
    { from: 0, to: 2 },
    { from: 7, to: 9 },
  ]);
});

test("fenced code block insertion wraps selected text", () => {
  const doc = Text.of(["texto"]);
  const result = getFencedCodeBlockInsertion(doc, 0, 5, "texto");

  assert.equal(result.insert, "```\ntexto\n```");
  assert.equal(result.bodyFrom, 4);
  assert.equal(result.bodyTo, 9);
});

test("fenced code block insertion separates surrounding inline text", () => {
  const doc = Text.of(["antes texto despues"]);
  const from = 6;
  const to = 11;
  const result = getFencedCodeBlockInsertion(doc, from, to, "texto");

  assert.equal(result.insert, "\n```\ntexto\n```\n");
  assert.equal(result.bodyFrom, 11);
  assert.equal(result.bodyTo, 16);
});

test("fenced code block insertion keeps empty block cursor target inside fence", () => {
  const doc = Text.of([""]);
  const result = getFencedCodeBlockInsertion(doc, 0, 0, "");

  assert.equal(result.insert, "```\n\n```");
  assert.equal(result.bodyFrom, 4);
  assert.equal(result.bodyTo, 4);
});
