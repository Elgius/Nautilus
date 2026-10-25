"use client";

import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <AuthShell>
      <h1>We couldn’t load your workspace.</h1>
      <p className="auth-copy">Please check your connection and try again.</p>
      <Button className="auth-submit" onClick={reset}>
        Try again
      </Button>
    </AuthShell>
  );
}
