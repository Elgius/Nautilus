import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { readWorkspaceSession } from "./server-api";

export const getWorkspaceSession = cache(async () =>
  readWorkspaceSession((await headers()).get("cookie")),
);

export async function requireSession(returnTo = "/organizations") {
  const result = await getWorkspaceSession();
  if (result.status === "unavailable") return result;
  if (!result.data) redirect(`/login?${new URLSearchParams({ next: returnTo })}`);
  return { status: "ok", data: result.data } as const;
}
