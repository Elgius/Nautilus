import { SavedWorkspace } from "@/components/workspace/saved-workspace";
import { Suspense } from "react";
import { WorkspaceGate } from "@/components/auth/workspace-gate";
import { AuthLoading } from "@/components/auth/auth-shell";

export default function Home() {
  return (
    <Suspense fallback={<AuthLoading />}>
      <WorkspaceGate>
        <SavedWorkspace />
      </WorkspaceGate>
    </Suspense>
  );
}
