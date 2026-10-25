"use client";

import { createContext, useContext, useState } from "react";
import { getWorkspaceSession } from "@/lib/auth-client";
import type { WorkspaceSession } from "@/lib/auth-types";

const SessionContext = createContext<{
  session: WorkspaceSession;
  refresh: () => Promise<WorkspaceSession>;
} | null>(null);

export function WorkspaceSessionProvider({
  initialSession,
  children,
}: {
  initialSession: WorkspaceSession;
  children: React.ReactNode;
}) {
  const [session, setSession] = useState(initialSession);
  async function refresh() {
    const next = await getWorkspaceSession();
    setSession(next);
    return next;
  }
  return (
    <SessionContext.Provider value={{ session, refresh }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useWorkspaceSession() {
  const context = useContext(SessionContext);
  if (!context) throw new Error("Workspace requires an authenticated session.");
  return context;
}
