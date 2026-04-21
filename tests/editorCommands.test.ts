import test from "node:test";
import assert from "node:assert/strict";
import { Text } from "@codemirror/state";
import {
  getFencedCodeBlockInsertion,
  normalizeMarkdownInlineRange,
} from "../src/components/editor/editorCommands.ts";

test("markdown inline range trims surrounding spaces before adding marks", () => {
  const doc = Text.of([" texto "]);

  assert.deepEqual(normalizeMarkdownInlineRange(doc, 0, 7), { from: 1, to: 6 });
});

test("markdown inline range skips list prefix and trims item text spaces", () => {
  const doc = Text.of(["-  texto "]);

  assert.deepEqual(normalizeMarkdownInlineRange(doc, 0, 9), { from: 3, to: 8 });
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
