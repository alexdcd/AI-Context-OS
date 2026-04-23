import { StateEffect, StateField, type Extension, type EditorState } from "@codemirror/state";
import { ViewPlugin, type EditorView } from "@codemirror/view";
import {
  selectionHasRange,
  shouldRefreshActivePreviewLines,
  type PreviewSelectionUpdate,
} from "./editorPreviewState.ts";

const SIMPLE_CLICK_REVEAL_DELAY_MS = 160;
const MULTI_CLICK_RANGE_SETTLE_DELAY_MS = 80;

export const setMouseSelecting = StateEffect.define<boolean>();
export const setMouseSelectionClickDetail = StateEffect.define<number>();

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

export const mouseSelectionClickDetailField = StateField.define<number>({
  create() {
    return 0;
  },
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setMouseSelectionClickDetail)) {
        return effect.value;
      }
    }
    return value;
  },
});

export function isMouseSelecting(state: EditorState) {
  return state.field(mouseSelectingField, false);
}

export function getMouseSelectionClickDetail(state: EditorState) {
  return state.field(mouseSelectionClickDetailField, false) || 0;
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

export function getMouseSelectingClearDelayMs(state: EditorState) {
  if (!selectionHasRange(state.selection)) {
    return SIMPLE_CLICK_REVEAL_DELAY_MS;
  }

  return getMouseSelectionClickDetail(state) >= 2 ? MULTI_CLICK_RANGE_SETTLE_DELAY_MS : 0;
}

const mouseSelectingTracker = ViewPlugin.fromClass(
  class {
    private view: EditorView;
    private documentMouseupHandler: ((event: MouseEvent) => void) | null = null;
    private clearMouseSelectingTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(view: EditorView) {
      this.view = view;
      this.view.contentDOM.addEventListener("mousedown", this.handleMousedown);
    }

    destroy() {
      this.view.contentDOM.removeEventListener("mousedown", this.handleMousedown);
      this.detachDocumentMouseup();
      this.clearPendingMouseSelectingClear();
    }

    private handleMousedown = (event: MouseEvent) => {
      if (event.button !== 0) {
        return;
      }

      this.clearPendingMouseSelectingClear();

      this.view.dispatch({
        effects: [
          setMouseSelecting.of(true),
          setMouseSelectionClickDetail.of(event.detail),
        ],
      });

      this.detachDocumentMouseup();
      this.documentMouseupHandler = () => {
        this.detachDocumentMouseup();
        requestAnimationFrame(() => {
          if (isMouseSelecting(this.view.state)) {
            const delay = getMouseSelectingClearDelayMs(this.view.state);
            this.clearMouseSelectingTimer = setTimeout(() => {
              this.clearMouseSelectingTimer = null;
              if (isMouseSelecting(this.view.state)) {
                this.view.dispatch({
                  effects: [
                    setMouseSelecting.of(false),
                    setMouseSelectionClickDetail.of(0),
                  ],
                });
              }
            }, delay);
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

    private clearPendingMouseSelectingClear() {
      if (!this.clearMouseSelectingTimer) {
        return;
      }

      clearTimeout(this.clearMouseSelectingTimer);
      this.clearMouseSelectingTimer = null;
    }
  },
);

export function createMouseSelectingExtension(): Extension {
  return [mouseSelectingField, mouseSelectionClickDetailField, mouseSelectingTracker];
}
