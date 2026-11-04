'use client';

import { useEffect, useState } from 'react';
import { roomRequest } from '@/lib/room-client';
import type { RoomWorkState } from '../../../../shared/room-chat';

/** Polling covers read-only viewers, reconnects, and missed socket notifications.
 * Unknown status fails closed; local-only file previews do not use this guard.
 */
export function useRoomWork(organizationId: string, roomId: string) {
  const [state, setState] = useState<{ work: RoomWorkState; available: boolean }>({
    work: { locked: true, queued: 0, activities: [], expiresAt: null }, available: false,
  });
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    let generation = 0;
    const receive = (event: Event) => {
      const { detail } = event as CustomEvent<{ organizationId: string; roomId: string; work: RoomWorkState }>;
      if (detail.organizationId !== organizationId || detail.roomId !== roomId) return;
      generation++;
      setState({ work: detail.work, available: true });
    };
    async function poll() {
      const started = generation;
      try {
        const work = await roomRequest<RoomWorkState>(organizationId, `/${encodeURIComponent(roomId)}/work`, 'GET', undefined, AbortSignal.timeout(5000));
        if (!disposed && started === generation) setState({ work, available: true });
      } catch {
        if (!disposed && started === generation) setState((previous) => ({ ...previous, available: false }));
      } finally { if (!disposed) timer = setTimeout(poll, 1500); }
    }
    window.addEventListener('room-work-update', receive);
    void poll();
    return () => { disposed = true; clearTimeout(timer); window.removeEventListener('room-work-update', receive); };
  }, [organizationId, roomId]);
  return { ...state.work, available: state.available, readOnly: !state.available || state.work.locked };
}
