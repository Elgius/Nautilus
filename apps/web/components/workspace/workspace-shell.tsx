"use client";

import { WorkspaceCache } from "./workspace-cache";
import { useWorkspaceSession } from "@/components/auth/workspace-session";
import { Workspace } from "./workspace";

export function WorkspaceShell({ children }: { children: React.ReactNode }) {
  const { session } = useWorkspaceSession();
  const scope = `${session.user.id}:${session.activeOrganization?.id}`;
  return <WorkspaceCache key={scope}>
    <Workspace key={scope}>{children}</Workspace>
  </WorkspaceCache>;
}
