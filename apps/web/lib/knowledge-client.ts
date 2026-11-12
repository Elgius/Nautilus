export type KnowledgeScope = 'PERSONAL' | 'ORGANIZATION';
export type KnowledgeCitation = { id: string; documentVersionId: string | null; messageHash: string | null; locator: string; quote: string };
export type KnowledgeRevision = { id: string; revision: number; title: string; body: string; createdAt: string; citations: KnowledgeCitation[] };
export type KnowledgeSource = {
  id: string; roomId: string; documentId: string | null; messageId: string | null; title: string; available: boolean;
  taggedAt: string; lastError: string | null; canRemove: boolean;
  run: { id: string; status: string; nextChunk: number; error: string | null; finishedAt: string | null } | null;
  entry: { id: string; title: string; body: string; revision: number; updatedAt: string } | null;
};
export type KnowledgePage = {
  base: { id: string; enabled: boolean; nextRefreshAt: string; lastCheckedAt: string | null };
  agent: { name: string; refreshHours: number }; sources: KnowledgeSource[]; nextCursor: string | null;
};
export function knowledgeUrl(organizationId: string, path = '') {
  return `/api/organizations/${encodeURIComponent(organizationId)}/knowledge${path}`;
}
export async function knowledgeRequest<T>(organizationId: string, path = '', method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(knowledgeUrl(organizationId, path), { method, credentials: 'include', cache: 'no-store',
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) throw new Error(result?.error || 'Couldn’t load or save knowledge. Please try again.');
  return result;
}
