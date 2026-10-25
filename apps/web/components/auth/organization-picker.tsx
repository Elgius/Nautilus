"use client";

import { useState, type FormEvent } from "react";
import { ArrowRight, Check } from "lucide-react";
import {
  authClient,
  checkAuthResult,
  errorMessage,
  getWorkspaceSession,
  signOut,
  navigateWithFreshSession,
} from "@/lib/auth-client";
import { initials, type WorkspaceSession } from "@/lib/auth-types";
import { AuthShell } from "./auth-shell";
import { Button } from "@/components/ui/button";

export function OrganizationPicker({
  initialSession,
}: {
  initialSession: WorkspaceSession;
}) {
  const [session, setSession] = useState(initialSession);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");
  async function choose(organizationId: string) {
    setPending(organizationId);
    setError("");
    try {
      checkAuthResult(
        await authClient.organization.setActive({ organizationId }),
      );
      // A full navigation discards the previous tenant's page and component state.
      navigateWithFreshSession("/");
    } catch (error) {
      setError(errorMessage(error));
      setPending(null);
    }
  }
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setPending("create");
    setError("");
    try {
      const result = await authClient.organization.create({
        name: String(data.get("name")).trim(),
        slug: String(data.get("slug")).trim().toLowerCase(),
      });
      checkAuthResult(result);
      setSession(await getWorkspaceSession());
      form.reset();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setPending(null);
    }
  }
  async function logout() {
    setPending("logout");
    setError("");
    try {
      await signOut();
    } catch (error) {
      setError(errorMessage(error));
      setPending(null);
    }
  }
  return (
    <AuthShell wide>
      <h1>
        {session.memberships.length
          ? "Choose your organisation."
          : "Welcome to Nautilus."}
      </h1>
      <p className="auth-copy">
        {session.memberships.length
          ? "Select an organisation to open its workspace."
          : session.user.platformRole === "admin"
            ? "Create your first organisation, then invite your team."
            : "Your account is ready. Open an invitation email to join your organisation."}
      </p>
      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}
      <div className="auth-org-list" aria-label="Your organisations">
        {session.memberships.map(({ organization, role }) => (
          <Button variant="ghost" size="sm"
            className="auth-org-button h-auto justify-start whitespace-normal"
            key={organization.id}
            disabled={pending !== null}
            onClick={() => choose(organization.id)}
            aria-label={`Open ${organization.name}`}
          >
            <span className="auth-org-icon" aria-hidden="true">
              {initials(organization.name)}
            </span>
            <span className="auth-org-name">
              <strong>{organization.name}</strong>
              <small>{pending === organization.id ? "Opening…" : role}</small>
            </span>
            {session.activeOrganization?.id === organization.id ? (
              <Check size={18} aria-label="Current organisation" />
            ) : (
              <ArrowRight size={18} aria-hidden="true" />
            )}
          </Button>
        ))}
      </div>
      {!session.memberships.length && session.user.platformRole !== "admin" && (
        <div className="auth-empty">
          No organisation memberships yet. If you haven’t received an
          invitation, contact your organisation administrator.
        </div>
      )}
      {session.user.platformRole === "admin" && (
        <>
          <div className="auth-divider" />
          <h2>Create an organisation</h2>
          <form
            className="auth-form"
            onSubmit={create}
            aria-busy={pending === "create"}
          >
            <label className="auth-field" htmlFor="organization-name">
              Organisation name
              <input
                id="organization-name"
                name="name"
                required
                maxLength={100}
                disabled={pending !== null}
              />
            </label>
            <label className="auth-field" htmlFor="organization-slug">
              Organisation slug
              <input
                id="organization-slug"
                name="slug"
                required
                maxLength={64}
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                title="Use lowercase letters, numbers and single hyphens."
                placeholder="your-organisation"
                disabled={pending !== null}
              />
              <small>
                A unique name using lowercase letters, numbers and hyphens.
              </small>
            </label>
            <Button
              type="submit"
              className="auth-submit"
              disabled={pending !== null}
            >
              {pending === "create" ? "Creating…" : "Create organisation"}
            </Button>
          </form>
        </>
      )}
      <div className="auth-account">
        <span>{session.user.email}</span>
        <Button variant="ghost" onClick={logout} disabled={pending !== null}>
          {pending === "logout" ? "Signing out…" : "Sign out"}
        </Button>
      </div>
    </AuthShell>
  );
}
