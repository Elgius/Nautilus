export type PreviewTextEdit =
  | { type: 'insertText'; index: number; text: string }
  | { type: 'replaceText' | 'deleteText'; start: number; end: number; expectedText: string; text: string };
export type DocumentPreview = { documentId: string; expectedVersionId: string; edits: PreviewTextEdit[] };

/** Decode an unfinished JSON string/container, never evaluate model output.
 * Incomplete numbers/literals/keys are ignored until the next chunk arrives.
 */
export function parseDocumentPreview(input: string): DocumentPreview | null {
  if (input.length > 200_000) return null;
  const stack: string[] = [];
  let quoted = false, escaped = false;
  for (const char of input) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === '{') stack.push('}');
    else if (char === '[') stack.push(']');
    else if (char === '}' || char === ']') { if (stack.pop() !== char) return null; }
  }
  let repaired = input;
  if (quoted) {
    // Hold an unfinished escape (including a split Unicode escape) for later.
    repaired = repaired.replace(/\\(?:u[0-9a-fA-F]{0,3})?$/, '');
    repaired += '"';
  } else repaired = repaired.replace(/,\s*$/, '');
  repaired += stack.reverse().join('');
  try {
    const value = JSON.parse(repaired);
    if (!value || typeof value.documentId !== 'string' || typeof value.expectedVersionId !== 'string' || !Array.isArray(value.edits) || value.edits.length > 100) return null;
    const edits: PreviewTextEdit[] = [];
    const index = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
    for (const edit of value.edits) {
      // Formatting does not move text offsets. Skip it so a styled title or
      // paragraph earlier in the batch cannot suppress all subsequent text.
      if (edit?.type === 'formatText' || edit?.type === 'formatParagraph') continue;
      // Other segments have independent offsets; their text does not affect the
      // main body. Unknown operations still stop the preview conservatively.
      if (edit?.segmentId && ['insertText', 'replaceText', 'deleteText'].includes(edit.type)) continue;
      if (!edit || (edit.text !== undefined && (typeof edit.text !== 'string' || edit.text.length > 100_000))) break;
      if (edit.type === 'insertText' && index(edit.index) && typeof edit.text === 'string') edits.push({ type: edit.type, index: edit.index, text: edit.text });
      else if ((edit.type === 'replaceText' || edit.type === 'deleteText') && index(edit.start) && index(edit.end) && edit.end > edit.start && typeof edit.expectedText === 'string' && (edit.type === 'deleteText' || typeof edit.text === 'string')) edits.push({ type: edit.type, start: edit.start, end: edit.end, expectedText: edit.expectedText, text: edit.type === 'deleteText' ? '' : edit.text });
      else break;
    }
    return edits.length ? { documentId: value.documentId, expectedVersionId: value.expectedVersionId, edits } : null;
  } catch { return null; }
}
