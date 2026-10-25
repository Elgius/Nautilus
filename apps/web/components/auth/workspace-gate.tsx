import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth-server";
import { WorkspaceSessionProvider } from "./workspace-session";

export async function WorkspaceGate({
  children,
  returnTo = "/",
}: {
  children: React.ReactNode;
  returnTo?: string;
}) {
  const session = await requireSession(returnTo);
  if (!session.activeOrganization) redirect("/organizations");
  return (
    <WorkspaceSessionProvider
      key={session.activeOrganization.id}
      initialSession={session}
    >
      {children}
    </WorkspaceSessionProvider>
  );
}
