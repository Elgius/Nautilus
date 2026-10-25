import { Suspense } from "react";
import { PasswordForm } from "@/components/auth/password-form";
import { AuthLoading } from "@/components/auth/auth-shell";

export const metadata = { title: "Reset your password — Nautilus" };
export default function Page() {
  return (
    <Suspense fallback={<AuthLoading />}>
      <PasswordForm />
    </Suspense>
  );
}
