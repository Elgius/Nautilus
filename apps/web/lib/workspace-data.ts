"use client";

import useSWR from "swr";
import { toAgent, type StoredAgent } from "./agent-client";
import { toRoom, type RoomDisplayRecord } from "./room-client";
import type { Room } from "./room-data";
import type { Agent } from "./agent-data";

export async function workspaceFetch<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: "include", cache: "no-store" });
  if (!response.ok) throw new Error(response.status === 401 ? "Your session has expired. Sign in again." : "Couldn’t load workspace data. Please try again.");
  return response.json() as Promise<T>;
}

type RoomSummary = Omit<RoomDisplayRecord, "documents"> & {
  documents: { kind: "DOCUMENT" | "SPREADSHEET" }[];
  _count: { documents: number };
};
async function fetchRooms(url: string): Promise<Room[]> {
  const { rooms } = await workspaceFetch<{ rooms: RoomSummary[] }>(url);
  return rooms.map((room) => ({
    ...toRoom({ ...room, documents: [] }),
    documentCount: room._count.documents,
    contentTypes: room.documents.map(({ kind }) => kind === "DOCUMENT" ? "document" : "spreadsheet"),
  }));
}
async function fetchAgents(url: string): Promise<Agent[]> {
  const { agents } = await workspaceFetch<{ agents: StoredAgent[] }>(url);
  return agents.map(toAgent);
}

export function useWorkspaceData(organizationId: string, needsAgents: boolean) {
  const base = `/api/organizations/${encodeURIComponent(organizationId)}`;
  const rooms = useSWR(`${base}/rooms?summary=1`, fetchRooms);
  const agents = useSWR(needsAgents ? `${base}/agents` : null, fetchAgents, { keepPreviousData: true });
  return { rooms, agents };
}
