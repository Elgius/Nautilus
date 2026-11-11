"use client";

import { redirect, usePathname, useSearchParams } from "next/navigation";
import { safeReturnTo } from "@/lib/auth-routing";

export function WorkspaceLoginRedirect({ returnTo }: { returnTo?: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = searchParams.toString();
  const next = safeReturnTo(returnTo ?? `${pathname}${query ? `?${query}` : ""}`);
  return redirect(`/login?${new URLSearchParams({ next })}`);
}
