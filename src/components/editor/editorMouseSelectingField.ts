import { StateEffect, StateField, type Extension, type EditorState } from "@codemirror/state";
import { ViewPlugin, type EditorView } from "@codemirror/view";
import {
  shouldRefreshActivePreviewLines,
  type PreviewSelectionUpdate,
} from "./editorPreviewState.ts";

export const setMouseSelecting = StateEffect.define<boolean>();

export const mouseSelectingField = StateField.define<boolean>({
  create() {
    return false;
  },
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setMouseSelecting)) {
        return effect.value;
      }
    }
    return value;
  },
});

export function isMouseSelecting(state: EditorState) {
  return state.field(mouseSelectingField, false);
}

export function didFinishMouseSelecting(update: Pick<PreviewSelectionUpdate, "transactions">) {
  return update.transactions.some((transaction) =>
    transaction.effects.some(
      (effect) => effect.is(setMouseSelecting) && effect.value === false,
    ),
  );
}

export function shouldRefreshSensitivePreviewDecorations(
  update: PreviewSelectionUpdate,
  revealSyntaxOnActiveLine: boolean,
) {
  if (isMouseSelecting(update.state)) {
    return false;
  }

  if (didFinishMouseSelecting(update)) {
    return true;
  }

  return shouldRefreshActivePreviewLines(update, revealSyntaxOnActiveLine);
}

const mouseSelectingTracker = ViewPlugin.fromClass(
  class {
    private view: EditorView;
    private documentMouseupHandler: ((event: MouseEvent) => void) | null = null;

    constructor(view: EditorView) {
      this.view = view;
      this.view.contentDOM.addEventListener("mousedown", this.handleMousedown);
    }

    destroy() {
      this.view.contentDOM.removeEventListener("mousedown", this.handleMousedown);
      this.detachDocumentMouseup();
    }

    private handleMousedown = (event: MouseEvent) => {
      if (event.button !== 0) {
        return;
      }

      if (!isMouseSelecting(this.view.state)) {
        this.view.dispatch({ effects: setMouseSelecting.of(true) });
      }

      this.detachDocumentMouseup();
      this.documentMouseupHandler = () => {
        this.detachDocumentMouseup();
        requestAnimationFrame(() => {
          if (isMouseSelecting(this.view.state)) {
            this.view.dispatch({ effects: setMouseSelecting.of(false) });
          }
        });
      };
      document.addEventListener("mouseup", this.documentMouseupHandler, true);
    };

    private detachDocumentMouseup() {
      if (!this.documentMouseupHandler) {
        return;
      }

      document.removeEventListener("mouseup", this.documentMouseupHandler, true);
      this.documentMouseupHandler = null;
    }
  },
);

export function createMouseSelectingExtension(): Extension {
  return [mouseSelectingField, mouseSelectingTracker];
}
