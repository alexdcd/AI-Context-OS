export interface MouseSelectionGesture {
  button: number;
  detail: number;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

const STRUCTURAL_LINE_RE =
  /^(\s*([-*+]|\d+[.)]) (\[[ xX]\] )?|#{1,6} |> |---+\s*$|\*\*\*+\s*$|___+\s*$|\|)/;

export function isTaskCheckboxHitOffset(clickOffset: number) {
  return clickOffset <= 28;
}

export function isPlainPrimaryMouseGesture(
  gesture: MouseSelectionGesture,
) {
  return gesture.button === 0
    && !gesture.altKey
    && !gesture.ctrlKey
    && !gesture.metaKey
    && !gesture.shiftKey;
}

export function shouldUseTripleClickLineSelection(gesture: MouseSelectionGesture) {
  return gesture.detail >= 3 && isPlainPrimaryMouseGesture(gesture);
}

export function isStructuralMarkdownLine(text: string) {
  return STRUCTURAL_LINE_RE.test(text);
}

export function getTripleClickSelectionRange(
  doc: {
    lineAt: (pos: number) => { from: number; to: number; text: string; number: number };
    line: (number: number) => { from: number; to: number; text: string; number: number };
    lines: number;
  },
  pos: number,
) {
  const currentLine = doc.lineAt(pos);

  if (currentLine.text.trim().length === 0 || isStructuralMarkdownLine(currentLine.text)) {
    return { from: currentLine.from, to: currentLine.to };
  }

  let startLine = currentLine.number;
  let endLine = currentLine.number;

  while (startLine > 1) {
    const prevLine = doc.line(startLine - 1);
    if (prevLine.text.trim().length === 0 || isStructuralMarkdownLine(prevLine.text)) break;
    startLine -= 1;
  }

  while (endLine < doc.lines) {
    const nextLine = doc.line(endLine + 1);
    if (nextLine.text.trim().length === 0 || isStructuralMarkdownLine(nextLine.text)) break;
    endLine += 1;
  }

  return {
    from: doc.line(startLine).from,
    to: doc.line(endLine).to,
  };
}
