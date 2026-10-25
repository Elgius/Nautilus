import { Suspense } from "react";
import { InvitationForm } from "@/components/auth/invitation-form";
import { AuthLoading } from "@/components/auth/auth-shell";

export const metadata = { title: "Your invitation — Nautilus" };
export default function Page() {
  return (
    <Suspense fallback={<AuthLoading message="Opening your invitation…" />}>
      <InvitationForm />
    </Suspense>
  );
}
