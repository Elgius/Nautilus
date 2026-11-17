"use client";

import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

export function useRoomMessageTime() {
  // Hydration uses the server snapshot even when the browser has another locale
  // or time zone. React switches to local formatting after hydration completes.
  const local = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
  return (timestamp: string) => {
    const date = new Date(timestamp);
    if (local) return {
      label: date.toLocaleString(),
      time: date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    const iso = date.toISOString();
    return {
      label: `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC`,
      time: `${iso.slice(11, 16)} UTC`,
    };
  };
}
