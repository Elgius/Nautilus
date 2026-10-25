"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import {
  authClient,
  AuthRequestError,
  checkAuthResult,
  errorMessage,
  getWorkspaceSession,
  navigateWithFreshSession,
} from "@/lib/auth-client";
import { invitationPath, safeReturnTo } from "@/lib/auth-routing";
import { AuthShell } from "./auth-shell";
import { Button } from "@/components/ui/button";

export function LoginForm() {
  const params = useSearchParams();
  const invitationId = params.get("invitationId");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [verificationLink, setVerificationLink] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email")).trim().toLowerCase();
    setPending(true);
    setError("");
    setVerificationLink("");
    try {
      checkAuthResult(
        await authClient.signIn.email({
          email,
          password: String(data.get("password")),
        }),
      );
      const session = await getWorkspaceSession();
      navigateWithFreshSession(
        invitationId
          ? invitationPath(invitationId)
          : session.activeOrganization
            ? safeReturnTo(params.get("next"))
            : "/organizations",
      );
    } catch (error) {
      setError(errorMessage(error));
      if (
        error instanceof AuthRequestError &&
        error.code === "EMAIL_NOT_VERIFIED"
      ) {
        setVerificationLink(
          `/verify-email?${new URLSearchParams({ email, ...(invitationId ? { invitationId } : {}) })}`,
        );
      }
    } finally {
      setPending(false);
    }
  }
  return (
    <AuthShell>
      <h1>Welcome back.</h1>
      <p className="auth-copy">
        {invitationId
          ? "Sign in with your invited email to join your team."
          : "Sign in to your Nautilus workspace."}
      </p>
      {params.has("error") && (
        <p className="auth-error auth-notice" role="alert">
          This verification link is invalid or has expired. Sign in to request a
          new verification email.
        </p>
      )}
      {params.get("verified") === "1" && (
        <p className="auth-success auth-notice" role="status">
          Email verified. You can sign in now.
        </p>
      )}
      {params.get("passwordReset") === "1" && (
        <p className="auth-success auth-notice" role="status">
          Your password has been reset. Sign in with your new password.
        </p>
      )}
      <form className="auth-form" onSubmit={submit} aria-busy={pending}>
        <label className="auth-field" htmlFor="login-email">
          Email address
          <input
            id="login-email"
            name="email"
            type="email"
            autoComplete="username"
            required
            disabled={pending}
            autoFocus
          />
        </label>
        <label className="auth-field" htmlFor="login-password">
          Password
          <input
            id="login-password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            disabled={pending}
          />
        </label>
        {error && (
          <p className="auth-error" role="alert">
            {error}
            {verificationLink && (
              <>
                {" "}
                <Link className="auth-text-link" href={verificationLink}>
                  Check verification email
                </Link>
              </>
            )}
          </p>
        )}
        <Button type="submit" className="auth-submit" disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </Button>
      </form>
      <div className="auth-links">
        <Link href="/forgot-password">Forgot your password?</Link>
        {invitationId && (
          <Link href={invitationPath(invitationId)}>Create an account</Link>
        )}
      </div>
      {!invitationId && (
        <p className="auth-copy" style={{ margin: "24px 0 0", fontSize: 12 }}>
          New to Nautilus? Open the invitation from your organisation to create
          an account.
        </p>
      )}
    </AuthShell>
  );
}
