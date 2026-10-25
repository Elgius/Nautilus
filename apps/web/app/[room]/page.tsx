import { Suspense } from "react";
import { notFound } from "next/navigation";
import { RoomWorkspace } from "@/components/room/room-workspace";
import { headers } from "next/headers";
import { requireSession } from "@/lib/auth-server";
import type { RoomDetail } from "@/lib/room-client";
import { WorkspaceGate } from "@/components/auth/workspace-gate";
import "./room.css";

export const metadata = { title: "Room — Agents hub" };

async function SavedRoom({ roomId }: { roomId: string }) {
  const session = await requireSession(`/room-id=${encodeURIComponent(roomId)}`);
  if (!session.activeOrganization) return null;
  const response = await fetch(`${process.env.API_ORIGIN || 'http://localhost:8787'}/api/organizations/${encodeURIComponent(session.activeOrganization.id)}/rooms/${encodeURIComponent(roomId)}`, {
    headers: { cookie: (await headers()).get('cookie') || '' }, cache: 'no-store', signal: AbortSignal.timeout(15000),
  });
  if (response.status === 404) notFound();
  if (!response.ok) throw new Error('Couldn’t load this room. Please try again.');
  const data = await response.json() as RoomDetail;
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
