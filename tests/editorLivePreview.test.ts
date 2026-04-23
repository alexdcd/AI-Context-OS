import test from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import {
  getVisibleListMarkerDecoration,
  getMarkdownLinkLabelRange,
  hiddenSyntaxMark,
  hiddenSyntaxStyle,
  linkHasVisibleLabel,
  listSourceMarkerMark,
  shouldKeepCodeInfoVisible,
  shouldKeepListMarkerVisible,
  shouldHideMarkdownNode,
  shouldHideNamedLinkUrl,
  shouldRenderReplacePreviewWidget,
} from "../src/components/editor/editorLivePreview.ts";

function collectNodeNames(doc: string) {
  const state = EditorState.create({
    doc,
    extensions: [markdown({ base: markdownLanguage })],
  });
  const names = new Set<string>();

  syntaxTree(state).iterate({
    enter(node) {
      names.add(node.name);
    },
  });

  return names;
}

function findNode(doc: string, nodeName: string) {
  const state = EditorState.create({
    doc,
    extensions: [markdown({ base: markdownLanguage })],
  });
  let found: any = null;

  syntaxTree(state).iterate({
    enter(node) {
      if (!found && node.name === nodeName) {
        found = node.node;
      }
    },
  });

  assert.ok(found, `Expected ${nodeName} in test document`);
  return found;
}

function assertNamedLinkUrlHidden(doc: string) {
  const url = findNode(doc, "URL");
  const closingLabelMark = doc.indexOf("]");

  assert.equal(linkHasVisibleLabel(url.parent), true);
  assert.deepEqual(getMarkdownLinkLabelRange(url.parent), {
    from: 1,
    to: closingLabelMark,
  });
  assert.equal(shouldHideNamedLinkUrl("URL", url, false), true);
  assert.equal(shouldHideNamedLinkUrl("URL", url, true), false);
}

test("hidden markdown syntax uses a mark decoration instead of a replace decoration", () => {
  assert.equal((hiddenSyntaxMark as { isReplace?: boolean }).isReplace, undefined);
  assert.equal(hiddenSyntaxMark.spec.class, "cm-hidden-syntax");
});

test("hidden markdown syntax collapses tokens without removing them from editable flow", () => {
  assert.equal(hiddenSyntaxStyle.color, "transparent !important");
  assert.equal(
    hiddenSyntaxStyle.fontFamily,
    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important",
  );
  assert.equal(hiddenSyntaxStyle.fontSize, "1px !important");
  assert.equal(hiddenSyntaxStyle.letterSpacing, "-1ch !important");
  assert.equal("display" in hiddenSyntaxStyle, false);
  assert.equal("visibility" in hiddenSyntaxStyle, false);
  assert.equal("lineHeight" in hiddenSyntaxStyle, false);
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

test("list source markers stay visible while inline list syntax can still preview", () => {
  const listMark = findNode("- **bold** item", "ListMark");
  const taskListMark = findNode("- [ ] task", "ListMark");
  const taskMarker = findNode("- [ ] task", "TaskMarker");
  const emphasisMark = findNode("- **bold** item", "EmphasisMark");

  assert.equal(shouldKeepListMarkerVisible("ListMark", listMark), true);
  assert.equal(getVisibleListMarkerDecoration("ListMark", listMark), listSourceMarkerMark);
  assert.equal(shouldKeepListMarkerVisible("ListMark", taskListMark), false);
  assert.equal(shouldKeepListMarkerVisible("TaskMarker", taskMarker), false);
  assert.equal(shouldKeepListMarkerVisible("EmphasisMark", emphasisMark), false);
  assert.equal(shouldHideMarkdownNode("EmphasisMark", false), true);
});

test("code info stays visible when a fenced block has no code text body", () => {
  const singleLineCodeInfo = findNode("```code block\n```", "CodeInfo");
  const languageCodeInfo = findNode("```txt\ncode block\n```", "CodeInfo");

  assert.equal(shouldKeepCodeInfoVisible("CodeInfo", singleLineCodeInfo), true);
  assert.equal(shouldKeepCodeInfoVisible("CodeInfo", languageCodeInfo), false);
  assert.equal(shouldHideMarkdownNode("CodeInfo", false), true);
});

test("named markdown links hide the URL syntax only on inactive lines", () => {
  const namedUrl = findNode("[MafiaIA](https://mafiaia.com/)", "URL");
  const bareUrl = findNode("https://mafiaia.com/", "URL");
  const emptyLabelUrl = findNode("[](https://mafiaia.com/)", "URL");

  assertNamedLinkUrlHidden("[MafiaIA](https://mafiaia.com/)");
  assertNamedLinkUrlHidden("[**MafiaIA**](https://mafiaia.com/)");
  assertNamedLinkUrlHidden("[*MafiaIA*](https://mafiaia.com/)");
  assertNamedLinkUrlHidden("[`MafiaIA`](https://mafiaia.com/)");

  assert.equal(linkHasVisibleLabel(emptyLabelUrl.parent), false);
  assert.deepEqual(getMarkdownLinkLabelRange(namedUrl.parent), { from: 1, to: 8 });
  assert.equal(shouldHideNamedLinkUrl("URL", bareUrl, false), false);
  assert.equal(shouldHideNamedLinkUrl("URL", emptyLabelUrl, false), false);
});

test("live preview hiding covers the marker node names emitted by CodeMirror markdown", () => {
  const names = collectNodeNames([
    "# Heading",
    "",
    "This is **bold** and *italic* with [a link](https://example.com).",
    "- [ ] task",
    "> quote",
  ].join("\n"));

  assert.equal(names.has("HeaderMark"), true);
  assert.equal(names.has("EmphasisMark"), true);
  assert.equal(names.has("LinkMark"), true);
  assert.equal(names.has("ListMark"), true);
  assert.equal(names.has("TaskMarker"), true);
  assert.equal(names.has("QuoteMark"), true);

  assert.equal(shouldHideMarkdownNode("HeaderMark", false), true);
  assert.equal(shouldHideMarkdownNode("EmphasisMark", false), true);
  assert.equal(shouldHideMarkdownNode("LinkMark", false), true);
  assert.equal(shouldHideMarkdownNode("ListMark", false), true);
  assert.equal(shouldHideMarkdownNode("TaskMarker", false), true);
  assert.equal(shouldHideMarkdownNode("QuoteMark", false), true);
});

test("replace-based preview widgets stay disabled while the editor is editable", () => {
  assert.equal(shouldRenderReplacePreviewWidget(true, false), false);
  assert.equal(shouldRenderReplacePreviewWidget(true, true), false);
  assert.equal(shouldRenderReplacePreviewWidget(false, true), false);
  assert.equal(shouldRenderReplacePreviewWidget(false, false), true);
});
