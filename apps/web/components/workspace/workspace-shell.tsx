"use client";

import { SWRConfig } from "swr";
import { useWorkspaceSession } from "@/components/auth/workspace-session";
import { Workspace } from "./workspace";

// A fresh provider on identity changes prevents cross-user/organisation cache reuse.
const cacheOptions = {
  provider: () => new Map(),
  dedupingInterval: 30_000,
  revalidateOnFocus: true,
  shouldRetryOnError: false,
};

export function WorkspaceShell({ children }: { children: React.ReactNode }) {
  const { session } = useWorkspaceSession();
  const scope = `${session.user.id}:${session.activeOrganization?.id}`;
  return <SWRConfig key={scope} value={cacheOptions}>
    <Workspace key={scope}>{children}</Workspace>
  </SWRConfig>;
}
