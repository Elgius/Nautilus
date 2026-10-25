import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { WorkspaceSession } from "./auth-types";

export const getWorkspaceSession = cache(
  async (): Promise<WorkspaceSession | null> => {
    const cookie = (await headers()).get("cookie");
    if (!cookie) return null;
    const response = await fetch(
      `${process.env.API_ORIGIN || "http://localhost:8787"}/api/me`,
      {
        headers: { cookie },
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (response.status === 401) return null;
    if (!response.ok)
      throw new Error("Unable to reach the authentication service.");
    return response.json();
  },
);

export async function requireSession(returnTo = "/organizations") {
  const session = await getWorkspaceSession();
  if (!session) redirect(`/login?${new URLSearchParams({ next: returnTo })}`);
  return session;
}
