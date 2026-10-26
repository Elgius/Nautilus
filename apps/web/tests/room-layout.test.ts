import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRoomLayout, clampChatWidth, DEFAULT_ROOM_LAYOUT } from '../lib/room-layout';

test('room layout restores valid width and collapsed preferences', () => {
  assert.deepEqual(parseRoomLayout(JSON.stringify({ width: 34, collapsed: true })), { width: 34, collapsed: true });
  assert.deepEqual(parseRoomLayout(JSON.stringify({ width: 34, collapsed: false })), { width: 34, collapsed: false });
});
test('invalid or unavailable stored preferences safely restore the default layout', () => {
  for (const raw of [null, '{', 'null', 'true', '"other"']) assert.deepEqual(parseRoomLayout(raw), DEFAULT_ROOM_LAYOUT);
  assert.deepEqual(parseRoomLayout('{"width":"100%","collapsed":"true"}'), DEFAULT_ROOM_LAYOUT);
  assert.equal(clampChatWidth(Infinity), 25);
  assert.equal(clampChatWidth(NaN), 25);
});
test('stored and dragged widths are bounded so both panels remain usable', () => {
  assert.equal(parseRoomLayout('{"width":100}').width, 45);
  assert.equal(parseRoomLayout('{"width":-50}').width, 18);
  assert.equal(clampChatWidth(30.25), 30.25);
});
