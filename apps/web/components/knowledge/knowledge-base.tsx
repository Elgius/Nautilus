"use client";

import { useState } from 'react';
import Link from 'next/link';
import useSWRInfinite from 'swr/infinite';
import { BookOpen, RefreshCw, LockKeyhole, Users, Pause, Play, Trash2 } from 'lucide-react';
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
    try { await knowledgeRequest(organizationId, path, method, body); await mutate(); setNotice(method === 'DELETE' ? 'Tag removed. Its findings are no longer available.' : path === '/refresh' ? 'Refresh queued. The agent will check tagged sources shortly.' : 'Agent settings saved.'); }
    catch (error) { setActionError(errorMessage(error)); }
    finally { setBusy(false); }
  }
  return <>
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4">
      <div><p className="font-medium">Knowledge agent · every 6 hours</p><p className="text-sm text-muted-foreground">{base ? base.enabled ? `Next check: ${new Date(base.nextRefreshAt).toLocaleString()}` : 'Agent paused' : 'Loading agent…'}</p>
        {base?.lastCheckedAt && <p className="text-xs text-muted-foreground">Last source check queued: {new Date(base.lastCheckedAt).toLocaleString()}</p>}
      </div>
      <div className="flex gap-2"><Button variant="outline" size="sm" disabled={busy || !base?.enabled} onClick={() => void action('/refresh', 'POST', { scope })}><RefreshCw size={14} />Refresh now</Button>
        {canManage && <Button variant="outline" size="sm" disabled={busy || !base} onClick={() => void action('', 'PATCH', { scope, enabled: !base?.enabled })}>{base?.enabled ? <Pause size={14} /> : <Play size={14} />}{base?.enabled ? 'Pause agent' : 'Resume agent'}</Button>}
      </div>
    </div>
    {notice && <p role="status" className="mt-3 text-sm">{notice}</p>}
    {(error || actionError) && <div role="alert" className="mt-3 text-sm text-destructive">{actionError || error.message} {error && <Button variant="ghost" size="sm" onClick={() => void mutate()}>Retry</Button>}</div>}
    {!data && !error && <p role="status" className="py-8 text-sm">Loading knowledge…</p>}
    {data && !sources.length && <div className="my-6 rounded-xl border border-dashed px-6 py-12 text-center"><BookOpen className="mx-auto mb-3 size-8 text-muted-foreground" /><h2 className="font-medium">Good work starts with good context.</h2><p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">Tag saved documents or individual room messages with Knowledge to start building this bucket. The agent reads only the sources you explicitly tag.</p></div>}
    <div className="my-6 grid gap-4">{sources.map((source) => <article key={source.id} className="min-w-0 rounded-xl border bg-card p-5">
      <div className="flex items-start justify-between gap-3"><div><h2 className="font-medium">{source.title}</h2><p className="mt-1 text-xs text-muted-foreground">{source.entry ? `Updated ${new Date(source.entry.updatedAt).toLocaleString()}` : source.run?.status === 'pending' || source.run?.status === 'running' ? `Processing · ${source.run.nextChunk} sections checked` : 'Awaiting source check'}</p></div>
        {source.canRemove && <Button variant="ghost" size="icon-sm" aria-label={`Remove ${source.title} from Knowledge`} disabled={busy} onClick={() => void action(`/sources/${source.id}?scope=${scope}`, 'DELETE')}><Trash2 size={14} /></Button>}
      </div>
      {source.lastError && <p role="alert" className="mt-3 text-sm text-destructive">{source.lastError}</p>}
      {source.entry && <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-relaxed">{source.entry.body}</p>}
      {source.available && <Link className="mt-3 inline-block text-sm underline underline-offset-4" href={`/${source.roomId}${source.messageId ? `#message-${source.messageId}` : ''}`}>Open source room</Link>}
      {source.available && source.entry && <SourceHistory organizationId={organizationId} scope={scope} source={source} />}
    </article>)}</div>
    {data?.at(-1)?.nextCursor && <Button variant="outline" disabled={isValidating} onClick={() => void setSize(size + 1)}>Load more sources</Button>}
  </>;
}

export function KnowledgeBase({ organizationId }: { organizationId: string }) {
  const { session } = useWorkspaceSession();
  const [scope, setScope] = useState<KnowledgeScope>('PERSONAL');
  const admin = canManageOrganization(session.memberships.find((m) => m.organizationId === organizationId)?.role);
  return <section className="mx-auto w-full max-w-5xl p-4 sm:p-6" aria-label="Knowledge base">
    <div className="page-heading"><div><h1>Knowledge</h1><p>Findings from explicitly tagged work. Personal stays yours; organization knowledge is shared with your team.</p></div></div>
    <div className="mb-5 flex gap-2" role="group" aria-label="Knowledge bucket">
      <Button variant={scope === 'PERSONAL' ? 'default' : 'outline'} aria-pressed={scope === 'PERSONAL'} onClick={() => setScope('PERSONAL')}><LockKeyhole size={15} />Personal</Button>
      <Button variant={scope === 'ORGANIZATION' ? 'default' : 'outline'} aria-pressed={scope === 'ORGANIZATION'} onClick={() => setScope('ORGANIZATION')}><Users size={15} />Organization</Button>
    </div>
    <KnowledgeBucket key={`${organizationId}:${session.user.id}:${scope}`} organizationId={organizationId} userId={session.user.id} scope={scope} canManage={scope === 'PERSONAL' || admin} />
  </section>;
}
