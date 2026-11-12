import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDocumentPreview } from '../../../shared/document-preview';
import { previewDocument, savedDocumentPreview } from '../lib/document-preview';
import { updateUniverDocument } from '../lib/univer-document-update';
import { officeContent, type OfficeContent } from '../lib/office-content';
import { createEditingRuntime } from '../../office/src/editing/runtime';

const base = officeContent('DOCUMENT', 'doc', 'Live document', { format: 'markdown', text: 'Hello world' }) as Extract<OfficeContent, { kind: 'DOCUMENT' }>;
const input = JSON.stringify({ documentId: 'doc', expectedVersionId: 'v1', edits: [{ type: 'replaceText', start: 6, end: 11, expectedText: 'world', text: 'ocean\nSecond paragraph 🌊' }] });

test('a saved response received after reconnect can also be typed from the current content', () => {
  const next = officeContent('DOCUMENT', 'doc', 'Live document', { format: 'markdown', text: 'Hello ocean\nSecond paragraph 🌊' });
  const draft = savedDocumentPreview(base, next, 'v1')!;
  assert.equal(previewDocument(base, draft)?.snapshot.body?.dataStream, next.kind === 'DOCUMENT' ? next.snapshot.body?.dataStream : '');
  assert.equal(savedDocumentPreview(base, base, 'v1'), null);
});

test('unfinished tool JSON produces progressively longer document previews without duplicating text', () => {
  const prefix = input.slice(0, input.indexOf('ocean'));
  for (const text of ['o', 'oce', 'ocean']) {
    const draft = parseDocumentPreview(prefix + text)!;
    assert.equal(draft.documentId, 'doc');
    assert.equal(previewDocument(base, draft)?.snapshot.body?.dataStream, `Hello ${text}\r\n`);
  }
  const full = previewDocument(base, parseDocumentPreview(input)!)!;
  assert.equal(full.snapshot.body?.dataStream, 'Hello ocean\rSecond paragraph 🌊\r\n');
  assert.equal(base.snapshot.body?.dataStream, 'Hello world\r\n');
  for (let i = 0; i <= input.length; i++) assert.doesNotThrow(() => parseDocumentPreview(input.slice(0, i)));
});

test('previews reject stale text and protected terminators and stop at unsupported edits', () => {
  const draft = parseDocumentPreview(input)!;
  assert.equal(previewDocument(base, { ...draft, edits: [{ type: 'replaceText', start: 0, end: 5, expectedText: 'stale', text: 'bad' }] }), null);
  assert.equal(previewDocument(base, { ...draft, edits: [{ type: 'insertText', index: 999, text: 'bad' }] }), null);
  assert.equal(parseDocumentPreview('{"documentId":"doc","expectedVersionId":"v1","edits":[{"type":"formatText"}]}'), null);
  assert.equal(parseDocumentPreview('x'.repeat(200_001)), null);
});

test('formatting and header edits before main-body text do not block progressive previews', () => {
  const input = JSON.stringify({ documentId: 'doc', expectedVersionId: 'v1', edits: [
    { type: 'formatText', start: 0, end: 5, style: { bl: 1 } },
    { type: 'formatParagraph', paragraphId: 'paragraph-0', style: { spaceAbove: 12 } },
    { type: 'insertText', segmentId: 'header', index: 0, text: 'Header' },
    { type: 'replaceText', start: 6, end: 11, expectedText: 'world', text: 'ocean' },
  ] });
  const prefix = input.slice(0, input.lastIndexOf('ocean'));
  for (const text of ['o', 'oce', 'ocean']) {
    assert.equal(previewDocument(base, parseDocumentPreview(prefix + text)!)?.snapshot.body?.dataStream, `Hello ${text}\r\n`);
  }
  const unknown = input.replace('formatText', 'unknownStructuralEdit');
  assert.equal(parseDocumentPreview(unknown), null, 'unknown operations may change offsets');
});

test('remote previews, rollback and final formatting update the same read-only Univer unit', async () => {
  const runtime = createEditingRuntime();
  try {
    const doc = runtime.api.createDocument(structuredClone(base.snapshot));
    await doc.getPermission().setEditable(false);
    const model = doc.getDocumentDataModel();
    const next = previewDocument(base, parseDocumentPreview(input)!)!;
    assert.equal(updateUniverDocument(runtime.api, next), true);
    assert.match(doc.getBody().dataStream, /Second paragraph/);
    assert.equal(runtime.api.getActiveDocument()?.getDocumentDataModel(), model);
    assert.equal(updateUniverDocument(runtime.api, base), true);
    assert.equal(doc.getBody().dataStream, 'Hello world\r\n');
    next.snapshot.body!.textRuns = [{ st: 0, ed: 5, ts: { bl: 1 } }];
    assert.equal(updateUniverDocument(runtime.api, next), true);
    assert.deepEqual(doc.getBody().textRuns, next.snapshot.body!.textRuns);
    assert.equal(runtime.api.getActiveDocument()?.getDocumentDataModel(), model);
  } finally { runtime.dispose(); }
});
