import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addLocalRoomFiles, MAX_LOCAL_FILES } from '../lib/local-room-files';
import { initialRoomFileState, roomFileReducer } from '../lib/room-file-state';

const file = (name: string, text = name) => new File([text], name, { type: 'text/plain' });

test('additional uploads open independently and preserve the original files across tab switches', () => {
  const first = addLocalRoomFiles([], [file('brief.txt', 'Original brief')]);
  const second = addLocalRoomFiles([], [file('notes.txt', 'Additional notes')]);
  const initial = initialRoomFileState('saved-document');
  const added = roomFileReducer(roomFileReducer(initial, { type: 'add', entries: first }), { type: 'add', entries: second });
  assert.equal(added.selectedId, second[0].id);
  assert.equal(added.files.length, 2);
  const back = roomFileReducer(added, { type: 'select', id: first[0].id });
  assert.equal(back.files[0].file, first[0].file);
  assert.equal(back.files[1].file, second[0].file);
  assert.deepEqual(back.visitedIds, ['saved-document', first[0].id, second[0].id]);
  assert.equal(roomFileReducer(back, { type: 'select', id: 'saved-document' }).files, back.files);
  assert.equal(initial.files.length, 0);
});

test('batched additions use the latest list and reject an entire over-limit batch', () => {
  const entries = addLocalRoomFiles([], Array.from({ length: MAX_LOCAL_FILES - 1 }, (_, i) => file(`${i}.txt`)));
  const first = roomFileReducer(initialRoomFileState(), { type: 'add', entries });
  const opened = roomFileReducer(first, { type: 'upload-dialog', open: true });
  const tooMany = roomFileReducer(opened, { type: 'add', entries: addLocalRoomFiles([], [file('a.txt'), file('b.txt')]) });
  assert.equal(tooMany.files, first.files);
  assert.equal(tooMany.selectedId, first.selectedId);
  assert.equal(tooMany.uploadOpen, true);
  assert.match(tooMany.error, /20 local files/);
  const last = roomFileReducer(tooMany, { type: 'add', entries: addLocalRoomFiles([], [file('last.txt')]) });
  assert.equal(last.files.length, MAX_LOCAL_FILES);
  assert.equal(last.uploadOpen, false);
  assert.equal(last.error, '');
});

test('removing active and inactive tabs never leaves a removed file selected', () => {
  const entries = addLocalRoomFiles([], [file('a.txt'), file('b.txt'), file('c.txt')]);
  const added = roomFileReducer(initialRoomFileState('saved'), { type: 'add', entries });
  const selected = roomFileReducer(added, { type: 'select', id: entries[1].id });
  const removedInactive = roomFileReducer(selected, { type: 'remove', id: entries[0].id, fallbackId: 'saved' });
  assert.equal(removedInactive.selectedId, entries[1].id);
  const removedActive = roomFileReducer(removedInactive, { type: 'remove', id: entries[1].id, fallbackId: 'saved' });
  assert.equal(removedActive.selectedId, entries[2].id);
  assert.ok(!removedActive.visitedIds.includes(entries[1].id));
  const last = roomFileReducer(removedActive, { type: 'remove', id: entries[2].id, fallbackId: 'saved' });
  assert.equal(last.selectedId, 'saved');
  assert.equal(last.files.length, 0);
  assert.equal(roomFileReducer(last, { type: 'remove', id: 'missing' }), last);
});

test('same-name uploads remain distinct and replaying an action does not duplicate tabs', () => {
  const entries = addLocalRoomFiles([], [file('same.txt', 'one'), file('same.txt', 'two')]);
  const action = { type: 'add' as const, entries };
  const initial = initialRoomFileState();
  const added = roomFileReducer(initial, action);
  assert.equal(added.files.length, 2);
  assert.notEqual(added.files[0].id, added.files[1].id);
  assert.deepEqual(roomFileReducer(initial, action), added);
  assert.equal(roomFileReducer(added, action), added);
  assert.equal(roomFileReducer(roomFileReducer(initial, { type: 'add', entries: entries.slice(0, 1) }), { type: 'remove', id: entries[0].id }).selectedId, undefined);
});

test('closing tabs retains files and visited drafts, and reopening restores their identity', () => {
  const entries = addLocalRoomFiles([], [file('brief.txt'), file('notes.txt')]);
  const added = roomFileReducer(initialRoomFileState('saved'), { type: 'add', entries });
  const selected = roomFileReducer(added, { type: 'select', id: entries[1].id });
  const closed = roomFileReducer(selected, { type: 'close', id: entries[1].id });
  assert.equal(closed.files, selected.files);
  assert.equal(closed.visitedIds, selected.visitedIds);
  assert.equal(closed.selectedId, entries[0].id);
  assert.ok(!closed.openIds.includes(entries[1].id));
  const reopened = roomFileReducer(closed, { type: 'select', id: entries[1].id });
  assert.equal(reopened.selectedId, entries[1].id);
  assert.equal(reopened.files[1].file, entries[1].file);
  assert.equal(reopened.openIds.filter((id) => id === entries[1].id).length, 1);
  assert.equal(roomFileReducer(reopened, { type: 'close', id: 'missing' }), reopened);
});

test('closing every tab clears selection while keeping the file browser intact', () => {
  const entries = addLocalRoomFiles([], [file('brief.txt')]);
  const added = roomFileReducer(initialRoomFileState(), { type: 'add', entries });
  const closed = roomFileReducer(added, { type: 'close', id: entries[0].id });
  assert.deepEqual(closed.openIds, []);
  assert.equal(closed.selectedId, undefined);
  assert.equal(closed.files.length, 1);
  const reopened = roomFileReducer(closed, { type: 'select', id: entries[0].id });
  assert.equal(reopened.openIds.length, 1);
});
