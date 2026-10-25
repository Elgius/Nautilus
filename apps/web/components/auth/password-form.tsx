"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import {
  authClient,
  checkAuthResult,
  errorMessage,
  navigateWithFreshSession,
} from "@/lib/auth-client";
import { AuthShell } from "./auth-shell";
import { Button } from "@/components/ui/button";

export function PasswordForm({ reset = false }: { reset?: boolean }) {
  const params = useSearchParams();
  const token = params.get("token");
  const invalidLink = reset && (!token || params.has("error"));
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setPending(true);
    setError("");
    try {
      if (reset && token) {
        checkAuthResult(
          await authClient.resetPassword({
            token,
            newPassword: String(data.get("password")),
          }),
        );
        navigateWithFreshSession("/login?passwordReset=1");
      } else {
        checkAuthResult(
          await authClient.requestPasswordReset({
            email: String(data.get("email")).trim().toLowerCase(),
            redirectTo: `${window.location.origin}/reset-password`,
          }),
        );
        setSent(true);
      }
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setPending(false);
    }
  }
  return (
    <AuthShell>
      <h1>{reset ? "Choose a new password." : "Reset your password."}</h1>
      <p className="auth-copy">
        {invalidLink
          ? "This password reset link is missing or expired. Request a new one to continue."
          : reset
            ? "Use a unique password with at least 12 characters."
            : "We’ll send you a link to reset your password."}
      </p>
      {invalidLink ? (
        <Link className="auth-text-link" href="/forgot-password">
          Request a new reset link
        </Link>
      ) : sent ? (
        <p className="auth-success" role="status">
          If an account exists for that email, a reset link has been sent.
          Please check your inbox.
        </p>
      ) : (
        <form className="auth-form" onSubmit={submit} aria-busy={pending}>
          {reset ? (
            <label className="auth-field" htmlFor="reset-password">
              New password
              <input
                id="reset-password"
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={128}
                required
                disabled={pending}
              />
            </label>
          ) : (
            <label className="auth-field" htmlFor="reset-email">
              Email address
              <input
                id="reset-email"
                name="email"
                type="email"
                autoComplete="email"
                required
                disabled={pending}
              />
            </label>
          )}
          {error && (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}
          <Button className="auth-submit" type="submit" disabled={pending}>
            {pending
              ? "Please wait…"
              : reset
                ? "Save new password"
                : "Send reset link"}
          </Button>
        </form>
      )}
      <div className="auth-links">
        <Link href="/login">Back to sign in</Link>
      </div>
    </AuthShell>
  );
}
