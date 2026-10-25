import type { Room } from './room-data';

export type RoomDocument = {
  id: string; title: string; kind: 'DOCUMENT' | 'SPREADSHEET'; category: string;
  status: 'DRAFT' | 'IN_REVIEW' | 'READY'; currentVersionId: string | null; updatedAt: string;
};
export type RoomRecord = {
  id: string; name: string; description: string; category: string; color: string;
  status: 'READY' | 'WORKING' | 'NEEDS_REVIEW'; lastActivityAt: string;
  agents: { agent: { id: string; name: string } }[];
  members: { organizationMemberId: string; role: string; member: { user: { id: string; name: string } } }[];
  stars: { userId: string }[]; documents: RoomDocument[];
};
export type RoomMessage = {
  id: string; text: string; createdAt: string; editedAt: string | null; authorUserId: string | null;
  authorUser: { name: string } | null; authorAgent: { name: string } | null;
  documents: { documentId: string; documentVersionId: string | null; document: { title: string; kind: string } }[];
};
export type DocumentVersion = {
  id: string; versionNumber: number; sizeBytes: number; createdAt: string; changeSummary: string | null;
  authorUser: { name: string } | null; authorAgent: { name: string } | null;
};
export type RoomDetail = { room: RoomRecord; messages: RoomMessage[]; nextCursor: string | null; storageConfigured: boolean; officeConfigured: boolean };

export function toRoom(room: RoomRecord): Room {
  return { id: room.id, name: room.name, description: room.description, category: room.category, color: room.color,
    status: { READY: 'Ready', WORKING: 'Working', NEEDS_REVIEW: 'Needs review' }[room.status] as Room['status'],
    agents: room.agents.map(({ agent }) => agent.name), agentIds: room.agents.map(({ agent }) => agent.id),
    members: room.members.map(({ member }) => member.user.name.split(' ').filter(Boolean).map((part) => part[0]).slice(0, 2).join('')),
    documentCount: room.documents.length, documents: room.documents, updated: new Date(room.lastActivityAt).toLocaleDateString(), favorite: !!room.stars.length,
    contentTypes: [...new Set(room.documents.map((document) => document.kind === 'DOCUMENT' ? 'document' as const : 'spreadsheet' as const))],
  };
}

export async function roomRequest<T>(organizationId: string, path = '', method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api/organizations/${encodeURIComponent(organizationId)}/rooms${path}`, {
    method, credentials: 'include', cache: 'no-store',
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) throw new Error(result?.error || 'Couldn’t load or save this room. Please try again.');
  return result;
}
