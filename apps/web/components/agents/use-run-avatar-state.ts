import { useEffect, useState } from 'react';
import type { AvatarState } from 'open-bot-avatar';

export function useRunAvatarState(state: AvatarState, runKey?: string): AvatarState {
  const [previous, setPrevious] = useState({ state, runKey });
  const [celebrating, setCelebrating] = useState(false);
  if (previous.state !== state || previous.runKey !== runKey) {
    setPrevious({ state, runKey });
    setCelebrating(previous.runKey === runKey && state === 'done' &&
      (previous.state === 'thinking' || previous.state === 'working' || previous.state === 'waiting'));
  }
  useEffect(() => {
    if (!celebrating) return;
    const timer = window.setTimeout(() => setCelebrating(false), 2400);
    return () => window.clearTimeout(timer);
  }, [celebrating]);

  return state === 'done' && !celebrating ? 'idle' : state;
}
