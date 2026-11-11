import { Suspense } from "react";
import { WorkspaceGate } from "@/components/auth/workspace-gate";
import { AuthLoading } from "@/components/auth/auth-shell";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  // These pages are empty route slots; the persistent shell owns the views.
  // Keep the slots in the render tree even when auth redirects or the cache
  // waits for hydration, so Next can validate every navigation segment.
  return <>
    {children}
    <Suspense fallback={<AuthLoading />}>
      <WorkspaceGate><WorkspaceShell /></WorkspaceGate>
    </Suspense>
  </>;
}
