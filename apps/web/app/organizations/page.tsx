import { Suspense } from "react";
import { requireSession } from "@/lib/auth-server";
import { OrganizationPicker } from "@/components/auth/organization-picker";
import { AuthLoading } from "@/components/auth/auth-shell";

export const metadata = { title: "Choose your organisation — Nautilus" };
async function Organizations() {
  return <OrganizationPicker initialSession={await requireSession()} />;
}
export default function Page() {
  return (
    <Suspense fallback={<AuthLoading message="Loading your organisations…" />}>
      <Organizations />
    </Suspense>
  );
}
