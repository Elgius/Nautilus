"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import {
  authClient,
  checkAuthResult,
  errorMessage,
  navigateWithFreshSession,
} from "@/lib/auth-client";
import { loginPath } from "@/lib/auth-routing";
import { AuthShell, AuthLoading } from "./auth-shell";
import { Button } from "@/components/ui/button";

function InvitationSignup({ invitationId }: { invitationId: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setError("");
    setPending(true);
    try {
      const email = String(data.get("email")).trim().toLowerCase();
      const callback = new URL(loginPath(invitationId), window.location.origin);
      callback.searchParams.set("verified", "1");
      checkAuthResult(
        await authClient.signUp.email(
          {
            name: String(data.get("name")).trim(),
            email,
            password: String(data.get("password")),
            callbackURL: callback.toString(),
          },
          { headers: { "X-Invitation-Id": invitationId } },
        ),
      );
      navigateWithFreshSession(
        `/verify-email?${new URLSearchParams({ email, invitationId })}`,
      );
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setPending(false);
    }
  }
  return (
    <AuthShell>
      <h1>You’re invited.</h1>
      <p className="auth-copy">
        Create your account using the email address that received this
        invitation.
      </p>
      <form className="auth-form" onSubmit={submit} aria-busy={pending}>
        <label className="auth-field" htmlFor="signup-name">
          Your name
          <input
            id="signup-name"
            name="name"
            autoComplete="name"
            maxLength={100}
            required
            disabled={pending}
            autoFocus
          />
        </label>
        <label className="auth-field" htmlFor="signup-email">
          Invited email address
          <input
            id="signup-email"
            name="email"
            type="email"
            autoComplete="username"
            required
            disabled={pending}
          />
        </label>
        <label className="auth-field" htmlFor="signup-password">
          Password
          <input
            id="signup-password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={12}
            maxLength={128}
            required
            disabled={pending}
          />
          <small>Use at least 12 characters.</small>
        </label>
        {error && (
          <p className="auth-error" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" className="auth-submit" disabled={pending}>
          {pending ? "Creating account…" : "Create account"}
        </Button>
      </form>
      <div className="auth-links">
        <span>Already have an account?</span>
        <Link href={loginPath(invitationId)}>Sign in</Link>
      </div>
    </AuthShell>
  );
}

function InvitationAcceptance({
  invitationId,
  email,
}: {
  invitationId: string;
  email: string;
}) {
  const [invitation, setInvitation] = useState<{
    organizationName: string;
    role: string;
  } | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const result = await authClient.organization.getInvitation(
          { query: { id: invitationId } },
          { signal: controller.signal },
        );
        checkAuthResult(result);
        if (!controller.signal.aborted) setInvitation(result.data);
      } catch (error) {
        if (!controller.signal.aborted) setError(errorMessage(error));
      }
    }
    void load();
    return () => controller.abort();
  }, [invitationId]);
  async function accept() {
    setPending(true);
    setError("");
    try {
      checkAuthResult(
        await authClient.organization.acceptInvitation({ invitationId }),
      );
      navigateWithFreshSession("/");
    } catch (error) {
      setError(errorMessage(error));
      setPending(false);
    }
  }
  async function switchAccount() {
    setPending(true);
    setError("");
    try {
      checkAuthResult(await authClient.signOut());
      navigateWithFreshSession(loginPath(invitationId));
    } catch (error) {
      setError(errorMessage(error));
      setPending(false);
    }
  }
  return (
    <AuthShell>
      <h1>
        {invitation
          ? `Join ${invitation.organizationName}.`
          : error
            ? "Invitation unavailable."
            : "Opening your invitation…"}
      </h1>
      <p className="auth-copy">
        Signed in as <strong>{email}</strong>.
        {invitation
          ? ` You’ve been invited as ${invitation.role}.`
          : " Use the email address that received this invitation."}
      </p>
      {!invitation && !error && (
        <p role="status" className="auth-loading">
          Checking invitation…
        </p>
      )}
      {error && (
        <p className="auth-error auth-notice" role="alert">
          {error} The invitation may have expired, been cancelled, or belong to
          another email.
        </p>
      )}
      {invitation && (
        <Button className="auth-submit" onClick={accept} disabled={pending}>
          {pending ? "Joining…" : "Accept invitation"}
        </Button>
      )}
      <div className="auth-links">
        <Link href="/organizations">Your organisations</Link>
        <Button variant="ghost" size="sm"
          className="auth-text-link"
          onClick={switchAccount}
          disabled={pending}
        >
          Use another account
        </Button>
      </div>
    </AuthShell>
  );
}

export function InvitationForm() {
  const invitationId = useSearchParams().get("invitationId");
  const { data: session, isPending, error, refetch } = authClient.useSession();
  if (!invitationId)
    return (
      <AuthShell>
        <h1>Open your invitation.</h1>
        <p className="auth-copy">
          Use the link in your invitation email to create an account or join
          your organisation.
        </p>
        <Link className="auth-text-link" href="/login">
          Go to sign in
        </Link>
      </AuthShell>
    );
  if (isPending) return <AuthLoading message="Checking your session…" />;
  if (error)
    return (
      <AuthShell>
        <h1>We couldn’t connect.</h1>
        <p className="auth-copy">Please try loading your invitation again.</p>
        <Button onClick={() => refetch()}>Try again</Button>
      </AuthShell>
    );
  return session ? (
    <InvitationAcceptance
      key={`${invitationId}:${session.user.id}`}
      invitationId={invitationId}
      email={session.user.email}
    />
  ) : (
    <InvitationSignup invitationId={invitationId} />
  );
}
