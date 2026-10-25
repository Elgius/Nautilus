"use client";

import { createAuthClient } from "better-auth/react";
import { organizationClient } from "better-auth/client/plugins";
import type { WorkspaceSession } from "./auth-types";

export const authClient = createAuthClient({
  plugins: [organizationClient()],
  fetchOptions: { credentials: "include" },
});

export class AuthRequestError extends Error {
  constructor(
    message: string,
    public code?: string,
    public status?: number,
  ) {
    super(message);
  }
}

export function checkAuthResult(result: {
  error?: { message?: string; code?: string; status?: number } | null;
}) {
  if (result.error)
    throw new AuthRequestError(
      result.error.message || "The request could not be completed.",
      result.error.code,
      result.error.status,
    );
}

export function errorMessage(error: unknown) {
  if (error instanceof TypeError)
    return "We couldn’t connect. Please check your connection and try again.";
  return error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
}

export function navigateWithFreshSession(path: string) {
  const destination = new URL(path, window.location.origin);
  if (destination.origin !== window.location.origin)
    throw new Error("Invalid navigation destination.");
  // Deliberately reset page caches and in-memory state at an auth/tenant boundary.
  window.location.assign(destination.href);
}

export async function getWorkspaceSession(
  signal?: AbortSignal,
): Promise<WorkspaceSession> {
  const response = await fetch("/api/me", {
    credentials: "include",
    cache: "no-store",
    signal,
  });
  if (!response.ok)
    throw new AuthRequestError(
      response.status === 401
        ? "Please sign in again."
        : "We couldn’t load your organisations. Please try again.",
      undefined,
      response.status,
    );
  return response.json();
}

export async function signOut() {
  checkAuthResult(await authClient.signOut());
  // Discard cached pages and all in-memory workspace state on logout.
  navigateWithFreshSession("/login");
}
