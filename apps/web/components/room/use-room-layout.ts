'use client';
import { useMemo, useSyncExternalStore } from 'react';
import { parseRoomLayout, type RoomLayout } from '@/lib/room-layout';
const changed = 'nautilus-room-layout-changed';
function subscribe(notify: () => void) {
  window.addEventListener('storage', notify);
  window.addEventListener(changed, notify);
  return () => { window.removeEventListener('storage', notify); window.removeEventListener(changed, notify); };
}
const serverSnapshot = () => null;

function createLayoutStore(userId: string) {
  const key = `nautilus:room-layout:v1:${userId}`;
  let fallback: string | null = null;
  let storageUnavailable = false;
  return {
    snapshot: () => { try { return storageUnavailable ? fallback : localStorage.getItem(key); } catch { return fallback; } },
    update: (value: RoomLayout) => {
      fallback = JSON.stringify(value);
      try { localStorage.setItem(key, fallback); storageUnavailable = false; } catch { storageUnavailable = true; }
      window.dispatchEvent(new Event(changed));
    },
  };
}

export function useRoomLayout(userId: string) {
  const store = useMemo(() => createLayoutStore(userId), [userId]);
  const raw = useSyncExternalStore(subscribe, store.snapshot, serverSnapshot);
  return [parseRoomLayout(raw), store.update] as const;
}
