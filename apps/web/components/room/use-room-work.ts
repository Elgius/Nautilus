'use client';

import { useEffect, useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { roomRequest, type RoomRecord, type RoomDetail } from '@/lib/room-client';
import type { RoomWorkState } from '../../../../shared/room-chat';

/** Polling covers read-only viewers, reconnects, and missed socket notifications.
 * Unknown status fails closed; local-only file previews do not use this guard.
 */
export function useRoomWork(organizationId: string, roomId: string, enabled = true) {
  const { compare } = useSWRConfig();
  const [state, setState] = useState<{ work: RoomWorkState; available: boolean }>({
    work: { locked: true, queued: 0, activities: [], expiresAt: null }, available: false,
  });
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    let generation = 0;
    function receiveWork(work: RoomWorkState) {
      setState(previous => previous.available && compare(previous.work, work)
        ? previous : { work, available: true });
    }
    const receive = (event: Event) => {
      const { detail } = event as CustomEvent<{ organizationId: string; roomId: string; work: RoomWorkState }>;
      if (detail.organizationId !== organizationId || detail.roomId !== roomId) return;
      generation++;
      receiveWork(detail.work);
    };
    async function poll() {
      const started = generation;
      try {
        const work = await roomRequest<RoomWorkState>(organizationId, `/${encodeURIComponent(roomId)}/work`, 'GET', undefined, AbortSignal.timeout(5000));
        if (!disposed && started === generation) receiveWork(work);
      } catch {
        if (!disposed && started === generation) setState(previous => previous.available ? { ...previous, available: false } : previous);
      } finally { if (!disposed) timer = setTimeout(poll, 1500); }
    }
    window.addEventListener('room-work-update', receive);
    void poll();
    return () => { disposed = true; clearTimeout(timer); window.removeEventListener('room-work-update', receive); };
  }, [organizationId, roomId, enabled, compare]);
  return { ...state.work, available: state.available, readOnly: !state.available || state.work.locked };
}

export function useRoomAgentRoster(organizationId: string, roomId: string, userId: string, initial: RoomRecord['agents'], work: ReturnType<typeof useRoomWork>) {
  const { data: participants = initial, mutate: refresh } = useSWR(
    ['room-agent-roster', organizationId, roomId, userId],
    async () => (await roomRequest<RoomDetail>(organizationId, `/${encodeURIComponent(roomId)}`)).room.agents,
    { fallbackData: initial, revalidateOnMount: false, revalidateOnFocus: false },
  );
  const missingId = work.available && work.activities.find(activity =>
    !participants.some(({ agent }) => agent.id === activity.agentId))?.agentId;
  useEffect(() => {
    if (missingId) void refresh();
  }, [missingId, refresh]);
  return participants;
}
