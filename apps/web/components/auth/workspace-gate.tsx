import { redirect } from "next/navigation";
import { getWorkspaceSession } from "@/lib/auth-server";
import { WorkspaceLoginRedirect } from "./workspace-login-redirect";
import { WorkspaceSessionProvider } from "./workspace-session";

export async function WorkspaceGate({
  children,
  returnTo,
}: {
  children: React.ReactNode;
  returnTo?: string;
}) {
  const session = await getWorkspaceSession();
  if (!session) return <WorkspaceLoginRedirect returnTo={returnTo} />;
  if (!session.activeOrganization) redirect("/organizations");
  return (
    <WorkspaceSessionProvider
      key={`${session.user.id}:${session.activeOrganization.id}`}
      initialSession={session}
    >
      {children}
    </WorkspaceSessionProvider>
  );
}
