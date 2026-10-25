export type Organization = { id: string; name: string; slug: string };
export type Membership = {
  organizationId: string;
  role: string;
  organization: Organization;
};
export type WorkspaceSession = {
  user: {
    id: string;
    name: string;
    email: string;
    emailVerified: boolean;
    platformRole: string;
  };
  memberships: Membership[];
  activeOrganization: Organization | null;
  needsOrganizationSelection: boolean;
};

export function initials(name: string) {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase() || "U"
  );
}

export function canManageOrganization(role?: string) {
  return (
    role?.split(",").some((value) => value === "owner" || value === "admin") ??
    false
  );
}
