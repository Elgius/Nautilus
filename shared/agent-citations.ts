import type { HubCitation, HubSource } from './room-chat';

export function hubSourceUrl(source: HubSource): string {
  if (source.kind === 'task' && source.taskId) return `/kanban?task=${encodeURIComponent(source.taskId)}`;
  return `/room-id=${encodeURIComponent(source.roomId)}${source.documentId ? `?document=${encodeURIComponent(source.documentId)}` : source.messageId ? `#message-${encodeURIComponent(source.messageId)}` : ''}`;
}

/** Resolve model citation markers against retrieved evidence; model URLs are never provenance. */
export function buildHubCitations(text: string, sources: HubSource[]): HubCitation[] {
  const available = new Map(sources.map((source) => [source.id, source]));
  const citations: HubCitation[] = [];
  const seen = new Set<string>();
  // Match the platform's deliberately narrow citation marker, outside fenced/inline code.
  const prose = text.replace(/```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]*`/g, '');
  for (const match of prose.matchAll(/\[[^\]\n]*\]\(#source-([a-zA-Z0-9_-]+)\)/g)) {
    const source = available.get(match[1]);
    if (!source || seen.has(source.id)) continue;
    seen.add(source.id);
    const evidence = source.citations[0];
    citations.push({ id: `citation-${citations.length + 1}`, number: citations.length + 1, sourceId: source.id,
      sourceType: source.kind ?? 'knowledge', title: source.title, url: hubSourceUrl(source), scope: source.scope,
      quote: evidence?.quote ?? '', locator: evidence?.locator ?? '', documentVersionId: evidence?.documentVersionId ?? null,
      ...(source.revision !== undefined ? { revision: source.revision } : {}),
    });
  }
  return citations;
}
