"use client";

import { useState, type FormEvent } from "react";
import { authClient, checkAuthResult, errorMessage } from "@/lib/auth-client";
import { canManageOrganization } from "@/lib/auth-types";
import { useWorkspaceSession } from "./workspace-session";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";

export function InviteMembers() {
  const { session } = useWorkspaceSession();
  const organizationId = session.activeOrganization?.id;
  const role = session.memberships.find(
    (membership) => membership.organizationId === organizationId,
  )?.role;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const email = String(data.get("email")).trim().toLowerCase();
    setPending(true);
    setError("");
    setSent("");
    try {
      checkAuthResult(
        await authClient.organization.inviteMember({
          organizationId,
          email,
          role: String(data.get("role")) as "member" | "admin" | "owner",
        }),
      );
      setSent(`Invitation sent to ${email}. It expires in 48 hours.`);
      form.reset();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setPending(false);
    }
  }
  if (!canManageOrganization(role))
    return (
      <p className="auth-copy">
        Ask an organisation owner or admin to invite a teammate.
      </p>
    );
  return (
    <form className="auth-form" onSubmit={submit} aria-busy={pending}>
      <label className="auth-field" htmlFor="invite-email">
        Email address
        <input
          id="invite-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          disabled={pending}
        />
      </label>
      <label className="auth-field" htmlFor="invite-role">
        Organisation role
        <Select name="role" defaultValue="member" disabled={pending}
          items={[{ value: "member", label: "Member" }, { value: "admin", label: "Admin" },
            ...(role?.split(",").includes("owner") ? [{ value: "owner", label: "Owner" }] : [])]}>
          <SelectTrigger id="invite-role" className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="member">Member</SelectItem>
            <SelectItem value="admin">Admin</SelectItem>
            {role?.split(",").includes("owner") && <SelectItem value="owner">Owner</SelectItem>}
          </SelectContent>
        </Select>
      </label>
      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}
      {sent && (
        <p className="auth-success" role="status">
          {sent}
        </p>
      )}
      <Button className="auth-submit" type="submit" disabled={pending}>
        {pending ? "Sending invitation…" : "Send invitation"}
      </Button>
    </form>
  );
}
