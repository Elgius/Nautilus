export type RoomLayout = { width: number; collapsed: boolean };
export const DEFAULT_ROOM_LAYOUT: RoomLayout = { width: 25, collapsed: false };
export function clampChatWidth(width: number) {
  return Number.isFinite(width) ? Math.min(45, Math.max(18, width)) : 25;
}
export function parseRoomLayout(raw: string | null): RoomLayout {
  try {
    const value: unknown = JSON.parse(raw ?? 'null');
    if (typeof value !== 'object' || value === null) return DEFAULT_ROOM_LAYOUT;
    const { width, collapsed } = value as Partial<RoomLayout>;
    return { width: clampChatWidth(typeof width === 'number' ? width : 25), collapsed: collapsed === true };
  } catch { return DEFAULT_ROOM_LAYOUT; }
}
