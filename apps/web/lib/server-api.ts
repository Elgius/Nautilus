import type { WorkspaceSession } from "./auth-types";

export type ApiReadResult<T> =
  | { status: "ok"; data: T }
  | { status: "unavailable" }
  | { status: "http-error"; code: number };

function isConnectionFailure(error: unknown) {
  return error instanceof TypeError ||
    (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name));
}

/** Read-only requests: temporary outages are expected state, not render errors. */
export async function readServerApi<T>(path: string, cookie: string): Promise<ApiReadResult<T>> {
  // Validate configuration outside the connection-error handler.
  const url = new URL(path, process.env.API_ORIGIN || "http://localhost:8787");
  try {
    const response = await fetch(url, {
      headers: { cookie },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if ([502, 503, 504].includes(response.status)) return { status: "unavailable" };
    if (!response.ok) return { status: "http-error", code: response.status };
    return { status: "ok", data: await response.json() as T };
  } catch (error) {
    // Includes a connection interrupted while reading the response body. Invalid
    // JSON and unexpected programming errors still reach the error boundary.
    if (isConnectionFailure(error)) return { status: "unavailable" };
    throw error;
  }
}

export async function readWorkspaceSession(cookie: string | null) {
  if (!cookie) return { status: "ok", data: null } as const;
  const result = await readServerApi<WorkspaceSession>("/api/me", cookie);
  if (result.status === "http-error") {
    if (result.code === 401) return { status: "ok", data: null } as const;
    throw new Error("Unable to load your session.");
  }
  return result;
}
