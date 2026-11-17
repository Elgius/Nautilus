"use client";

import { useState } from 'react';
import Link from 'next/link';
import useSWRInfinite from 'swr/infinite';
import { BookOpen, Clock3, ExternalLink, LockKeyhole, Users, Trash2 } from 'lucide-react';
import { KnowledgeAgentDrawer } from './knowledge-agent-drawer';
import { Button } from '@/components/ui/button';
import { useWorkspaceSession } from '@/components/auth/workspace-session';
import { canManageOrganization } from '@/lib/auth-types';
import { errorMessage } from '@/lib/auth-client';
import { workspaceFetch } from '@/lib/workspace-data';
import { roomRequest } from '@/lib/room-client';
import { knowledgeRequest, knowledgeUrl, type KnowledgePage, type KnowledgeScope, type KnowledgeSource, type KnowledgeRevision } from '@/lib/knowledge-client';

function SourceHistory({ organizationId, scope, source }: { organizationId: string; scope: KnowledgeScope; source: KnowledgeSource }) {
  const [open, setOpen] = useState(false), [error, setError] = useState('');
  const { data, error: loadError, size, setSize, mutate } = useSWRInfinite<{ revisions: KnowledgeRevision[]; nextCursor: number | null }>(
    (_index, previous) => !open || (previous && !previous.nextCursor) ? null : knowledgeUrl(organizationId, `/sources/${source.id}/history?scope=${scope}${previous?.nextCursor ? `&before=${previous.nextCursor}` : ''}`), workspaceFetch,
  );
  async function openVersion(versionId: string) {
    try {
      setError('');
      const { url } = await roomRequest<{ url: string }>(organizationId, `/${source.roomId}/documents/${source.documentId}/versions/${versionId}/url`);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (error) { setError(errorMessage(error)); }
  }
  return <div className="mt-4 border-t pt-3">
    <Button variant="ghost" size="sm" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Hide evidence and history' : 'Evidence and history'}</Button>
    {open && <div className="grid gap-4 pt-3">
      {!data && !loadError && <p role="status">Loading history…</p>}
      {loadError && <div role="alert">Couldn’t load history. <Button variant="ghost" onClick={() => void mutate()}>Retry</Button></div>}
      {data?.flatMap((page) => page.revisions).map((revision) => <details key={revision.id} className="rounded-lg border p-3" open={revision.revision === source.entry?.revision}>
        <summary className="cursor-pointer text-sm font-medium">Revision {revision.revision} · {new Date(revision.createdAt).toLocaleString()}</summary>
        <p className="my-3 whitespace-pre-wrap text-sm">{revision.body}</p>
        <ul className="grid gap-2 text-xs text-muted-foreground">{revision.citations.map((citation) => <li key={citation.id}>
          <span>{citation.locator}</span>
          {citation.quote && <blockquote className="mt-1 border-l-2 pl-3 text-foreground">{citation.quote}</blockquote>}
          {citation.documentVersionId && <Button variant="link" size="sm" onClick={() => void openVersion(citation.documentVersionId!)}>Open cited version</Button>}
          {citation.messageHash && <span className="block break-all">Message fingerprint: {citation.messageHash}</span>}
        </li>)}</ul>
      </details>)}
      {data?.at(-1)?.nextCursor && <Button variant="outline" size="sm" onClick={() => void setSize(size + 1)}>Older revisions</Button>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>}
  </div>;
}

function KnowledgeBucket({ organizationId, userId, scope, canManage }: { organizationId: string; userId: string; scope: KnowledgeScope; canManage: boolean }) {
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [actionError, setActionError] = useState('');
  const { data, error, size, setSize, mutate, isValidating } = useSWRInfinite<KnowledgePage>(
    (_index, previous) => previous && !previous.nextCursor ? null : [knowledgeUrl(organizationId, `?scope=${scope}${previous?.nextCursor ? `&cursor=${previous.nextCursor}` : ''}`), userId] as const,
    ([url]: readonly [string, string]) => workspaceFetch<KnowledgePage>(url), { refreshInterval: 15_000, revalidateOnFocus: true },
  );
  const base = data?.[0].base, sources = data?.flatMap((page) => page.sources) ?? [];
  async function action(path: string, method: string, body?: unknown) {
    setBusy(true); setActionError(''); setNotice('');
    try { await knowledgeRequest(organizationId, path, method, body); await mutate(); setNotice('Tag removed. Its findings are no longer available.'); }
    catch (error) { setActionError(errorMessage(error)); }
    finally { setBusy(false); }
  }
  return <>
    {notice && <p role="status" className="mt-3 text-sm">{notice}</p>}
    {(error || actionError) && <div role="alert" className="mt-3 text-sm text-destructive">{actionError || error.message} {error && <Button variant="ghost" size="sm" onClick={() => void mutate()}>Retry</Button>}</div>}
    <div className="knowledge-section-title">
      <h2>Tagged sources</h2>
      {data && <span>{sources.length}{data.at(-1)?.nextCursor ? '+' : ''} {sources.length === 1 && !data.at(-1)?.nextCursor ? 'source' : 'sources'}</span>}
    </div>
    {!data && !error && <p role="status" className="py-8 text-sm">Loading knowledge…</p>}
    {data && !sources.length && <div className="rounded-xl border border-dashed px-6 py-12 text-center"><BookOpen className="mx-auto mb-3 size-8 text-muted-foreground" /><h2 className="font-medium">Good work starts with good context.</h2><p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">Tag saved documents or individual room messages with Knowledge to start building this bucket. The agent reads only the sources you explicitly tag.</p></div>}
    {sources.length > 0 && <div className="grid gap-4">{sources.map((source) => <article key={source.id} className="knowledge-source">
      <div className="knowledge-source-row">
        <div className="knowledge-source-summary">
          <h3>{source.title}</h3>
          <p><Clock3 size={16} aria-hidden="true" />{source.entry ? `Updated ${new Date(source.entry.updatedAt).toLocaleString()}` : source.run?.status === 'pending' || source.run?.status === 'running' ? `Processing · ${source.run.nextChunk} sections checked` : 'Awaiting source check'}</p>
        </div>
        <div className="knowledge-actions">
          {source.available && <Link className="knowledge-source-link" href={`/room-id=${encodeURIComponent(source.roomId)}${source.messageId ? `#message-${source.messageId}` : ''}`}><ExternalLink size={15} />Open source room</Link>}
          {source.canRemove && <Button variant="ghost" size="icon-sm" aria-label={`Remove ${source.title} from Knowledge`} disabled={busy} onClick={() => void action(`/sources/${source.id}?scope=${scope}`, 'DELETE')}><Trash2 size={15} /></Button>}
        </div>
      </div>
      {source.lastError && <p role="alert" className="mt-3 text-sm text-destructive">{source.lastError}</p>}
      {source.entry && <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-relaxed">{source.entry.body}</p>}
      {source.available && source.entry && <SourceHistory organizationId={organizationId} scope={scope} source={source} />}
    </article>)}</div>}
    {data?.at(-1)?.nextCursor && <Button variant="outline" disabled={isValidating} onClick={() => void setSize(size + 1)}>Load more sources</Button>}
    {base && <section aria-label="Workspace agents" className="grid gap-4">
      <div className="knowledge-section-title"><h2>Workspace agents</h2></div>
      {data[0].agents.length ? <div className="flex flex-wrap gap-x-5 gap-y-4">{data[0].agents.map(agent =>
        <KnowledgeAgentDrawer key={agent.id} agent={agent} active={base.enabled && !base.pausedAgentIds.includes(agent.id)}
          scope={scope} organizationId={organizationId} canManage={canManage} refreshHours={agent.refreshHours}
          nextRefreshAt={agent.nextRefreshAt} onChange={() => mutate()} />
      )}</div> : <p className="text-sm text-muted-foreground">No agents in this workspace yet.</p>}
    </section>}
  </>;
}

export function KnowledgeBase({ organizationId }: { organizationId: string }) {
  const { session } = useWorkspaceSession();
  const [scope, setScope] = useState<KnowledgeScope>('PERSONAL');
  const admin = canManageOrganization(session.memberships.find((m) => m.organizationId === organizationId)?.role);
  return <section className="knowledge-library" aria-label="Knowledge base">
    <div className="knowledge-scope">
    <div className="flex gap-2" role="group" aria-label="Knowledge bucket">
      <Button variant={scope === 'PERSONAL' ? 'default' : 'outline'} aria-pressed={scope === 'PERSONAL'} onClick={() => setScope('PERSONAL')}><LockKeyhole size={15} />Personal</Button>
      <Button variant={scope === 'ORGANIZATION' ? 'default' : 'outline'} aria-pressed={scope === 'ORGANIZATION'} onClick={() => setScope('ORGANIZATION')}><Users size={15} />Organization</Button>
    </div>
    <p>Personal knowledge is visible only to you. Organization knowledge is shared with your team.</p>
    </div>
    <KnowledgeBucket key={`${organizationId}:${session.user.id}:${scope}`} organizationId={organizationId} userId={session.user.id} scope={scope} canManage={scope === 'PERSONAL' || admin} />
  </section>;
}
