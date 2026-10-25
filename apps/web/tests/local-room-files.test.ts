import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addLocalRoomFiles, isLocalRoomFileId, localPreviewType, MAX_LOCAL_FILE_BYTES, MAX_LOCAL_FILES } from '../lib/local-room-files';

test('local uploads retain original files and cannot be mistaken for persisted document IDs', async () => {
  const text = new File(['Room brief'], 'brief.txt', { type: 'text/plain', lastModified: 100 });
  const word = new File(['Original bytes'], 'proposal.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  const entries = addLocalRoomFiles([], [text, word]);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].file, text);
  assert.equal(entries[1].file, word);
  assert.equal(await entries[0].file.text(), 'Room brief');
  assert.equal(entries[0].source, 'local');
  assert.ok(isLocalRoomFileId(entries[0].id));
  assert.notEqual(entries[0].id, entries[1].id);
  assert.equal(isLocalRoomFileId('persisted-document-uuid'), false);
  assert.equal(isLocalRoomFileId(undefined), false);
});

test('local upload limits reject the entire batch without changing existing files', () => {
  const existing = addLocalRoomFiles([], [new File(['Keep'], 'existing.txt')]);
  assert.throws(() => addLocalRoomFiles(existing, [new File([], 'empty.txt')]));
  assert.throws(() => addLocalRoomFiles(existing, [new File([new ArrayBuffer(MAX_LOCAL_FILE_BYTES + 1)], 'large.bin')]));
  assert.throws(() => addLocalRoomFiles(existing, Array.from({ length: MAX_LOCAL_FILES }, () => new File(['a'], 'a.txt'))));
  assert.equal(existing.length, 1);
});

test('preview selection never embeds executable HTML, SVG, or unknown Office formats', () => {
  assert.equal(localPreviewType({ name: 'note.html', type: 'text/html' }), 'text');
  assert.equal(localPreviewType({ name: 'image.svg', type: 'image/svg+xml' }), 'download');
  assert.equal(localPreviewType({ name: 'disguised.png', type: 'image/svg+xml' }), 'download');
  assert.equal(localPreviewType({ name: 'photo.png', type: 'image/png' }), 'image');
  assert.equal(localPreviewType({ name: 'report.pdf', type: 'application/pdf' }), 'pdf');
  assert.equal(localPreviewType({ name: 'book.xlsx', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'download');
});
