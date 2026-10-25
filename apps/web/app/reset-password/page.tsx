import { Suspense } from "react";
import { PasswordForm } from "@/components/auth/password-form";
import { AuthLoading } from "@/components/auth/auth-shell";

export const metadata = { title: "Choose a new password — Nautilus" };
export default function Page() {
  return (
    <Suspense fallback={<AuthLoading />}>
      <PasswordForm reset />
    </Suspense>
  );
}
