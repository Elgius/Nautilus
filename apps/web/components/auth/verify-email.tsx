"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { authClient, checkAuthResult, errorMessage } from "@/lib/auth-client";
import { loginPath } from "@/lib/auth-routing";
import { AuthShell } from "./auth-shell";
import { Button } from "@/components/ui/button";

export function VerifyEmail() {
  const params = useSearchParams();
  const email = params.get("email");
  const invitationId = params.get("invitationId");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  async function resend() {
    if (!email) return;
    setPending(true);
    setError("");
    try {
      const callback = new URL(loginPath(invitationId), window.location.origin);
      callback.searchParams.set("verified", "1");
      checkAuthResult(
        await authClient.sendVerificationEmail({
          email,
          callbackURL: callback.toString(),
        }),
      );
      setSent(true);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setPending(false);
    }
  }
  return (
    <AuthShell>
      <h1>Check your email.</h1>
      <p className="auth-copy">
        {email ? (
          <>
            Open the verification link sent to <strong>{email}</strong>, then
            sign in to accept your invitation.
          </>
        ) : (
          "Open the verification link in your email, then return to sign in."
        )}
      </p>
      {error && (
        <p className="auth-error auth-notice" role="alert">
          {error}
        </p>
      )}
      {sent && (
        <p className="auth-success auth-notice" role="status">
          If an account needs verification, a new link has been sent. Please
          check your inbox.
        </p>
      )}
      {email && (
        <Button
          className="auth-submit"
          onClick={resend}
          disabled={pending || sent}
        >
          {pending
            ? "Sending…"
            : sent
              ? "Verification requested"
              : "Resend verification email"}
        </Button>
      )}
      <div className="auth-links">
        <Link href={loginPath(invitationId)}>Back to sign in</Link>
      </div>
    </AuthShell>
  );
}
