import { TextX, TextXActionType, type IDocumentBody } from '@univerjs/presets';
import type { DocumentPreview } from '../../../shared/document-preview';
import type { OfficeContent } from './office-content';

/** Recover a typing target when a reconnect/poll delivers only a saved version. */
export function savedDocumentPreview(base: OfficeContent, next: OfficeContent, versionId: string): DocumentPreview | null {
  if (base.kind !== 'DOCUMENT' || next.kind !== 'DOCUMENT') return null;
  const before = base.snapshot.body?.dataStream, after = next.snapshot.body?.dataStream;
  if (!before?.endsWith('\r\n') || !after?.endsWith('\r\n') || before === after) return null;
  let start = 0, end = before.length - 2, nextEnd = after.length - 2;
  while (start < end && start < nextEnd && before[start] === after[start]) start++;
  if (start && /[\uD800-\uDBFF]/.test(before[start - 1])) start--;
  while (end > start && nextEnd > start && before[end - 1] === after[nextEnd - 1]) { end--; nextEnd--; }
  if (/[\uDC00-\uDFFF]/.test(before[end] ?? '')) { end++; nextEnd++; }
  const text = after.slice(start, nextEnd);
  return { documentId: base.snapshot.id, expectedVersionId: versionId, edits: end === start
    ? [{ type: 'insertText', index: start, text }]
    : [{ type: 'replaceText', start, end, expectedText: before.slice(start, end), text }] };
}

/** Recompute from the saved base: repeated cumulative chunks never duplicate text. */
export function previewDocument(base: OfficeContent, draft: DocumentPreview): Extract<OfficeContent, { kind: 'DOCUMENT' }> | null {
  if (base.kind !== 'DOCUMENT' || !base.snapshot.body) return null;
  const snapshot = structuredClone(base.snapshot);
  let body = snapshot.body!;
  for (const edit of draft.edits) {
    const start = edit.type === 'insertText' ? edit.index : edit.start;
    const end = edit.type === 'insertText' ? start : edit.end;
    if (start > body.dataStream.length - 2 || end > body.dataStream.length - 2 || (edit.type !== 'insertText' && body.dataStream.slice(start, end) !== edit.expectedText)) return null;
    const text = edit.text.replace(/\r\n|\n/g, '\r');
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)) return null;
    const insertion: IDocumentBody = { dataStream: text, paragraphs: Array.from(text.matchAll(/\r/g), (match) => ({ startIndex: match.index!, paragraphId: `preview-${start}-${match.index}` })) };
    const actions = new TextX();
    if (start) actions.push({ t: TextXActionType.RETAIN, len: start });
    if (end > start) actions.push({ t: TextXActionType.DELETE, len: end - start });
    if (text) actions.push({ t: TextXActionType.INSERT, len: text.length, body: insertion });
    body = TextX.apply(body, actions.serialize());
  }
  snapshot.body = body;
  return { format: 'univer', kind: 'DOCUMENT', snapshot };
}
