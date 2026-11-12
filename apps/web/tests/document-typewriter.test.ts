import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DocumentTypewriter, documentPreviewPrefix } from '../lib/document-typewriter';
import type { DocumentPreview } from '../../../shared/document-preview';

const draft = (text: string): DocumentPreview => ({ documentId: 'doc', expectedVersionId: 'v1', edits: [{ type: 'insertText', index: 0, text }] });

test('a whole backend response is revealed across frames and completion waits for the last character', async () => {
  let frame: FrameRequestCallback | undefined, time = 0;
  const visible: string[] = [];
  const writer = new DocumentTypewriter((preview) => visible.push(preview.edits[0].text), {
    request: (callback) => { frame = callback; return 1; }, cancel: () => { frame = undefined; },
  });
  const text = 'A complete response received in one network message.';
  writer.update(draft(text));
  assert.equal(visible.length, 0);
  let finished = false;
  const done = writer.finish().then(() => { finished = true; });
  const tick = () => { const callback = frame!; frame = undefined; callback(time += 16); };
  tick();
  assert.equal(visible[0], 'A');
  assert.equal(finished, false);
  while (frame) tick();
  await done;
  assert.equal(finished, true);
  assert.equal(visible.at(-1), text);
  assert.ok(visible.length > 10);
  assert.ok(visible.every((value, index) => !index || value.startsWith(visible[index - 1])));
});

test('prefixes preserve Unicode and defer operations whose offsets require earlier text', () => {
  const input = draft('🌊 sea');
  input.edits.push({ type: 'insertText', index: 6, text: ' next' });
  assert.equal(documentPreviewPrefix(input, 1).edits[0].text, '');
  assert.equal(documentPreviewPrefix(input, 2).edits[0].text, '🌊');
  assert.equal(documentPreviewPrefix(input, 3).edits.length, 1);
  assert.equal(documentPreviewPrefix(input, 7).edits[1].text, ' ');
});

test('cancellation cancels frames and releases a pending final reconciliation', async () => {
  let cancelled = false;
  const writer = new DocumentTypewriter(() => assert.fail('cancelled drafts must not render'), {
    request: () => 7, cancel: (id) => { assert.equal(id, 7); cancelled = true; },
  });
  writer.update(draft('Discard this draft'));
  const done = writer.finish();
  writer.cancel();
  await done;
  assert.equal(cancelled, true);
});
