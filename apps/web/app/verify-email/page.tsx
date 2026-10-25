import { Suspense } from "react";
import { VerifyEmail } from "@/components/auth/verify-email";
import { AuthLoading } from "@/components/auth/auth-shell";

export const metadata = { title: "Verify your email — Nautilus" };
export default function Page() {
  return (
    <Suspense fallback={<AuthLoading />}>
      <VerifyEmail />
    </Suspense>
  );
}
