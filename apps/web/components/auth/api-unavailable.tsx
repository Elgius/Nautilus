"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { AuthShell } from "./auth-shell";
import { Button } from "@/components/ui/button";

export function ApiUnavailable() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <AuthShell>
      <h1>Your workspace is temporarily unavailable.</h1>
      <p className="auth-copy" role="status" aria-live="polite">
        {pending ? "Reconnecting to your workspace…" : "We couldn’t connect to the service. Wait a moment, then try again."}
      </p>
      <Button className="auth-submit" disabled={pending} onClick={() => startTransition(() => router.refresh())}>
        {pending ? "Trying again…" : "Try again"}
      </Button>
    </AuthShell>
  );
}
