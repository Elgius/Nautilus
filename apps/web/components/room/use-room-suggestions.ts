"use client";

import { useEffect, useState } from "react";
import { roomRequest, type RoomMessage } from "@/lib/room-client";

export const defaultRoomSuggestions = ["Summarize the discussion", "What are the next steps?", "Help me review this document"];
type Result = { suggestions: string[]; retryAfterMs?: number };

export function useRoomSuggestions(organizationId: string, roomId: string, userId: string, enabled: boolean, messages: RoomMessage[]) {
  const scope = JSON.stringify([organizationId, roomId, userId]);
  const revision = JSON.stringify(messages.slice(-5).map(({ id, editedAt, text }) => [id, editedAt, text]));
  const [result, setResult] = useState<{ scope: string; revision: string; suggestions: string[] } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const data = await roomRequest<Result>(organizationId, `/${encodeURIComponent(roomId)}/suggestions`, 'POST');
        if (disposed) return;
        const valid = Array.isArray(data.suggestions) && data.suggestions.length === 3 && data.suggestions.every((text) => typeof text === 'string' && text.length >= 5 && text.length <= 64);
        setResult({ scope, revision, suggestions: valid ? data.suggestions : defaultRoomSuggestions });
        if (typeof data.retryAfterMs === 'number' && data.retryAfterMs > 0 && data.retryAfterMs <= 30_000) {
          timer = setTimeout(refresh, data.retryAfterMs + 100);
        }
      } catch {
        if (!disposed) setResult({ scope, revision, suggestions: defaultRoomSuggestions });
      }
    }
    // Message bursts settle before we request suggestions. Draft edits never trigger it.
    timer = setTimeout(refresh, 700);
    return () => { disposed = true; clearTimeout(timer); };
  }, [organizationId, roomId, enabled, scope, revision]);

  return enabled && result?.scope === scope && result.revision === revision ? result.suggestions : defaultRoomSuggestions;
}
