import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getWorkspaceSession } from "@/lib/auth-server";
import { invitationPath } from "@/lib/auth-routing";
import { LoginForm } from "@/components/auth/login-form";
import { AuthLoading } from "@/components/auth/auth-shell";

export const metadata = { title: "Sign in — Nautilus" };

async function LoginRoute({
  searchParams,
}: {
  searchParams: Promise<{ invitationId?: string }>;
}) {
  const [params, session] = await Promise.all([
    searchParams,
    getWorkspaceSession(),
  ]);
  if (session)
    redirect(
      params.invitationId
        ? invitationPath(params.invitationId)
        : session.activeOrganization
          ? "/"
          : "/organizations",
    );
  return <LoginForm />;
}

export default function Page(props: {
  searchParams: Promise<{ invitationId?: string }>;
}) {
  return (
    <Suspense fallback={<AuthLoading message="Opening sign in…" />}>
      <LoginRoute {...props} />
    </Suspense>
  );
}
