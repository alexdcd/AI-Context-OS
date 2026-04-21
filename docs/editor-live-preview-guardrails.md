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
- validate on real `.md` pages, not only isolated checklist examples
- compare against `main` if the editor starts showing raw syntax outside the active paragraph

## Selection guard

`mouseSelectingField` in `src/components/editor/editorMouseSelectingField.ts` tracks the native drag-selection cycle.

- `mousedown` sets the field to `true`
- `document` `mouseup` clears it in `requestAnimationFrame`, after native selection has settled
- sensitive preview plugins must not rebuild decorations while the field is `true`
- the clear effect is allowed to trigger one rebuild after mouseup

Read this section before touching `drag -> mouseup` behavior. Do not remove or bypass `mouseSelectingField` as a simplification unless an equivalent automated and manual selection test replaces it.

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
