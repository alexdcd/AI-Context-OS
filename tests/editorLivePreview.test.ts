import test from "node:test";
import assert from "node:assert/strict";
import {
  hiddenSyntaxMark,
  hiddenSyntaxStyle,
  shouldHideMarkdownNode,
  shouldRenderReplacePreviewWidget,
} from "../src/components/editor/editorLivePreview.ts";

test("hidden markdown syntax uses a mark decoration instead of a replace decoration", () => {
  assert.equal((hiddenSyntaxMark as { isReplace?: boolean }).isReplace, undefined);
  assert.equal(hiddenSyntaxMark.spec.class, "cm-hidden-syntax");
});

test("hidden markdown syntax preserves text metrics for native selection", () => {
  assert.equal(hiddenSyntaxStyle.color, "transparent");
  assert.equal("display" in hiddenSyntaxStyle, false);
  assert.equal("visibility" in hiddenSyntaxStyle, false);
  assert.equal("fontSize" in hiddenSyntaxStyle, false);
  assert.equal("lineHeight" in hiddenSyntaxStyle, false);
  assert.equal("letterSpacing" in hiddenSyntaxStyle, false);
  assert.equal("wordSpacing" in hiddenSyntaxStyle, false);
});

test("always-hidden markdown markers stay hidden even on the active line", () => {
  assert.equal(shouldHideMarkdownNode("ListMark", true), true);
  assert.equal(shouldHideMarkdownNode("TaskMarker", true), true);
});

test("inline syntax markers are only hidden when the line is inactive", () => {
  assert.equal(shouldHideMarkdownNode("StrongEmphasisMark", false), true);
  assert.equal(shouldHideMarkdownNode("StrongEmphasisMark", true), false);
});

test("replace-based preview widgets stay disabled while the editor is editable", () => {
  assert.equal(shouldRenderReplacePreviewWidget(true, false), false);
  assert.equal(shouldRenderReplacePreviewWidget(true, true), false);
  assert.equal(shouldRenderReplacePreviewWidget(false, true), false);
  assert.equal(shouldRenderReplacePreviewWidget(false, false), true);
});
