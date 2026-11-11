"use client";

import { useLayoutEffect, useState, type ReactNode } from "react";
import { SWRConfig } from "swr";

const cacheOptions = {
  provider: () => new Map(),
  dedupingInterval: 30_000,
  revalidateOnFocus: true,
  shouldRetryOnError: false,
};

export function WorkspaceCache({ children }: { children: ReactNode }) {
  const [active, setActive] = useState(false);
  useLayoutEffect(() => {
    // Synchronize rendering with SWR’s external cache lifecycle before paint.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActive(true);
    // Activity preserves refs but tears down effects. SWR removes its provider's
    // registry during cleanup, so remount it before rendering hooks on return.
    return () => setActive(false);
  }, []);
  return active ? <SWRConfig value={cacheOptions}>{children}</SWRConfig> : null;
}
