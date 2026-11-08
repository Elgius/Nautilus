import { Suspense } from "react";
import { WorkspaceGate } from "@/components/auth/workspace-gate";
import { AuthLoading } from "@/components/auth/auth-shell";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<AuthLoading />}>
    <WorkspaceGate><WorkspaceShell>{children}</WorkspaceShell></WorkspaceGate>
  </Suspense>;
}
