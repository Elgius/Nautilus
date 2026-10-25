import { headers } from "next/headers";
import { requireSession } from "@/lib/auth-server";
import { toAgent, type StoredAgent } from "@/lib/agent-client";
import { Workspace } from "./workspace";
import { toRoom, type RoomRecord } from "@/lib/room-client";

export async function SavedWorkspace() {
  const session = await requireSession("/");
  if (!session.activeOrganization) return null;
  const cookie = (await headers()).get("cookie") || "";
  const [agentsResponse, roomsResponse] = await Promise.all(['agents', 'rooms'].map((resource) => fetch(
    `${process.env.API_ORIGIN || "http://localhost:8787"}/api/organizations/${encodeURIComponent(session.activeOrganization!.id)}/${resource}`,
    { headers: { cookie }, cache: "no-store", signal: AbortSignal.timeout(15_000) },
  )));
  if (!agentsResponse.ok || !roomsResponse.ok) throw new Error("Couldn’t load your workspace. Please try again.");
  const [{ agents }, { rooms }] = await Promise.all([
    agentsResponse.json() as Promise<{ agents: StoredAgent[] }>, roomsResponse.json() as Promise<{ rooms: RoomRecord[] }>,
  ]);
  return <Workspace initialAgents={agents.map(toAgent)} initialRooms={rooms.map(toRoom)} />;
}
