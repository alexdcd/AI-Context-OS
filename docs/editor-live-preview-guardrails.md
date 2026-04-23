# Editor Live Preview Guardrails

This note captures a regression we already hit in the Markdown editor and should not repeat.

## Invariant

`HybridMarkdownEditor` must preserve Obsidian-style live preview behavior:

- inactive paragraphs render as clean rich text
- raw Markdown markers are only visible in the active paragraph being edited
- checklist lines must not show `- [ ]`, `- [x]`, or auxiliary inline markers in inactive paragraphs

`main` is the reference behavior for this invariant.

## What broke

We introduced extra CodeMirror decorations and widgets for checklist priority rendering directly inside the live preview pipeline.

That change was too invasive and caused `.md` pages to show raw Markdown syntax across the full document instead of only on the active paragraph.

## Safe rule

When modifying checklist UX in `src/components/editor/HybridMarkdownEditor.tsx`:

- treat `createLivePreviewPlugin()` as sensitive core rendering logic
- keep structural decorations and live-preview hiding behind separate switches
- preserve the existing marker-hiding flow used in `main`
- avoid overlapping `Decoration.replace`, `Decoration.mark`, and `Decoration.widget` ranges on task lines unless the behavior is verified manually
- keep inline marker hiding on `Decoration.mark`; do not replace source text inside editable live preview
- do not use `display: none` for editable hidden tokens; phase 5 collapses token width with monospace `1px` text and `letter-spacing: -1ch` while keeping source text in DOM flow
- regular/ordered list markers keep the raw source marker visible with subtle styling, while inline syntax inside list text still uses live preview; wrapped list lines were the first place where hidden marker geometry caused click/drag hit-testing regressions
- task checkbox decoration is intentionally kept separate from that fallback because it has behaved well so far
- editable line decorations must not add margins, fake heights, or generated text before source content; use paint-only styles such as color, background, and inset box-shadows for blockquote/code/table chrome
- fenced code `CodeInfo` is only safe to hide when the block has real `CodeText`; if a user writes text on the opening fence line, CodeMirror classifies that text as `CodeInfo`, and hiding it makes the block look empty
- external links and wikilinks stay clickable through `Decoration.mark` attributes plus editor DOM handlers; do not bring back `Decoration.replace` link widgets in editable mode just to add an icon or click target
- validate on real `.md` pages, not only isolated checklist examples
- compare against `main` if the editor starts showing raw syntax outside the active paragraph

## Selection guard

`mouseSelectingField` in `src/components/editor/editorMouseSelectingField.ts` tracks the native drag-selection cycle.

- `mousedown` sets the field to `true`
- `document` `mouseup` clears it in `requestAnimationFrame`, after native selection has settled
- sensitive preview plugins must not rebuild decorations while the field is `true`
- range selections clear immediately after mouseup; simple clicks clear after a short double-click window so a click still reveals syntax for editing, but not between the first and second click of native word selection

Read this section before touching `drag -> mouseup` behavior. Do not remove or bypass `mouseSelectingField` as a simplification unless an equivalent automated and manual selection test replaces it.

## Reference Implementation Notes

`blueberrycongee/codemirror-live-markdown` was used as a reference, not as a dependency.

Ideas adopted from that repo:

- use a dedicated `mouseSelectingField` so sensitive decoration plugins skip rebuilds during native drag selection
- keep live-preview syntax hiding as `Decoration.mark`
- use one decision path for whether source syntax should be shown or previewed
- treat block markers (`HeaderMark`, `ListMark`, `QuoteMark`) differently from inline markers
- avoid generated editor widgets/replacements inside editable text while stabilizing selection

Intentional differences in this app:

- regular and ordered list source markers remain visible with subtle accent styling because wrapped list lines were the most fragile selection surface
- task checkbox decoration remains in place because it has stayed stable during manual testing
- rich `Decoration.replace` widgets remain disabled for editable preview via `shouldRenderReplacePreviewWidget(editable, lineIsActive)`
- code block, table, quote, and horizontal-rule chrome must be paint-only on editable lines; do not add margins, fake heights, generated labels, or line-level text that is not present in the document

If this is upstreamed or shared publicly, the most useful lesson is: in CodeMirror editable live preview, preserving browser hit-testing is more important than matching every read-mode visual. Paint around source text; do not move or replace it.

## Product wiring

The settings toggle owns the raw-vs-preview contract:

- `showSyntax={true}` means raw Markdown is visible everywhere
- `showSyntax={false}` means live preview is active
- `revealSyntaxOnActiveLine={!showMarkdownSyntax}` keeps syntax reveal aligned with preview mode in both L1 and L2 editors

`ChatPanel` intentionally passes `showSyntax={true}` with `editable={false}` while live preview is being stabilized. Keep chat in that conservative mode unless its read-only preview behavior is explicitly reviewed.

`settingsStore` version 1 deliberately migrates legacy persisted `showMarkdownSyntax` values back to `false`. This gives users the restored live-preview baseline after the period where the global presentation switch made raw syntax visible regardless of the setting. After that migration, explicit user changes are preserved.

## Safer implementation strategy

Prefer changes that do not alter the core live preview hiding logic:

- cursor placement improvements in `editorCommands.ts`
- markdown mutations on click, like toggling `[ ]` to `[x]`
- toolbar insertion improvements

If a richer checklist priority UI is reintroduced later, it should be implemented in a way that does not interfere with the baseline live preview decoration model.
