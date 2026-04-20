export interface StructuralMouseSelectionGesture {
  button: number;
  detail: number;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

const STRUCTURAL_SELECTION_LINE_CLASSES = [
  "cm-bullet-item",
  "cm-ordered-item",
  "cm-task-item",
] as const;

export function hasStructuralSelectionLineClass(className: string) {
  return STRUCTURAL_SELECTION_LINE_CLASSES.some((candidate) => className.includes(candidate));
}

export function isTaskCheckboxHitOffset(clickOffset: number) {
  return clickOffset <= 28;
}

export function shouldUseStructuralMouseSelection(
  gesture: StructuralMouseSelectionGesture,
  lineClassName: string,
  clickOffset: number,
) {
  if (gesture.button !== 0 || gesture.detail !== 1) {
    return false;
  }

  if (gesture.altKey || gesture.ctrlKey || gesture.metaKey || gesture.shiftKey) {
    return false;
  }

  if (!hasStructuralSelectionLineClass(lineClassName)) {
    return false;
  }

  if (lineClassName.includes("cm-task-item") && isTaskCheckboxHitOffset(clickOffset)) {
    return false;
  }

  return true;
}
