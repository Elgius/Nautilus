import { ApiUnavailable } from "@/components/auth/api-unavailable";
import { readServerApi } from "@/lib/server-api";
import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { RoomWorkspace } from "@/components/room/room-workspace";
import { headers } from "next/headers";
import { requireSession } from "@/lib/auth-server";
import type { RoomDetail } from "@/lib/room-client";
import { WorkspaceGate } from "@/components/auth/workspace-gate";
import "./room.css";

export const metadata = { title: "Room — Agents hub" };

async function SavedRoom({ roomId }: { roomId: string }) {
  const sessionResult = await requireSession(`/room-id=${encodeURIComponent(roomId)}`);
  if (sessionResult.status === "unavailable") return <ApiUnavailable />;
  const session = sessionResult.data;
  if (!session.activeOrganization) return null;
  const result = await readServerApi<RoomDetail>(
    `/api/organizations/${encodeURIComponent(session.activeOrganization.id)}/rooms/${encodeURIComponent(roomId)}`,
    (await headers()).get("cookie") || "",
  );
  if (result.status === "unavailable") return <ApiUnavailable />;
  if (result.status === "http-error") {
    if (result.code === 404) notFound();
    if (result.code === 401) redirect(`/login?${new URLSearchParams({ next: `/room-id=${encodeURIComponent(roomId)}` })}`);
    throw new Error("Couldn’t load this room. Please try again.");
  }
  const data = result.data;
  return <RoomWorkspace key={roomId} initialData={data} />;
}

async function RoomRoute({ params }: { params: Promise<{ room: string }> }) {
  const { room: encodedRoom } = await params;
  let room: string;
  try {
    room = decodeURIComponent(encodedRoom);
  } catch {
    notFound();
  }
  if (!room.startsWith("room-id=") || room.length <= "room-id=".length) {
    notFound();
  }
  const roomId = room.slice("room-id=".length);
  return (
    <WorkspaceGate returnTo={`/room-id=${encodeURIComponent(roomId)}`}>
      <SavedRoom roomId={roomId} />
    </WorkspaceGate>
  );
}

export default function Page({
  params,
}: {
  params: Promise<{ room: string }>;
}) {
  return (
    <Suspense
      fallback={
        <div className="room-loading" role="status">
          Opening room…
        </div>
      }
    >
      <RoomRoute params={params} />
    </Suspense>
  );
}
