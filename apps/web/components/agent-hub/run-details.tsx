"use client";

import { hubSourceUrl } from '../../../../shared/agent-citations';
import { useState } from 'react';
import type { PrivateAgentJob } from '../../../../shared/room-chat';
import { Tool, ToolContent, ToolHeader } from '@/components/ai-elements/tool';
import { Task, TaskContent, TaskItem, TaskTrigger } from '@/components/ai-elements/task';
import { Sources, SourcesContent, SourcesTrigger, Source } from '@/components/ai-elements/sources';
import { Confirmation, ConfirmationActions, ConfirmationAction, ConfirmationTitle } from '@/components/ai-elements/confirmation';
import { Checkpoint, CheckpointIcon } from '@/components/ai-elements/checkpoint';
import { ChainOfThought, ChainOfThoughtHeader, ChainOfThoughtContent, ChainOfThoughtStep } from '@/components/ai-elements/chain-of-thought';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export function RunDetails({ job, roomId, confirm }: { job: PrivateAgentJob; roomId?: string; confirm?: (jobId: string, confirmationId: string, approved: boolean) => void | Promise<void> }) {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState('');
  const active = job.status === 'running' || job.status === 'queued';
  return <div className="agent-run-details space-y-3 text-sm">
    {!!job.tools?.length && <ChainOfThought><ChainOfThoughtHeader>Activity · {job.tools.length} operations</ChainOfThoughtHeader><ChainOfThoughtContent>
      {job.tools.map((call) => <ChainOfThoughtStep key={call.id} label={call.name.replace(/([a-z])([A-Z])/g, '$1 $2')} status={call.status === 'running' ? 'active' : 'complete'}>
        <Tool><ToolHeader type="dynamic-tool" toolName={call.name} state={call.status === 'running' ? 'input-available' : call.status === 'failed' ? 'output-error' : 'output-available'} /><ToolContent><p>{call.summary ?? 'Working…'}</p></ToolContent></Tool>
      </ChainOfThoughtStep>)}
    </ChainOfThoughtContent></ChainOfThought>}
    {job.confirmations?.map((item) => <Confirmation key={item.id} approval={item.status === 'pending' ? { id: item.id } : { id: item.id, approved: item.status === 'approved' }} state={item.status === 'pending' && active ? 'approval-requested' : 'approval-responded'} className="rounded-lg border p-3">
      <ConfirmationTitle>{item.label}</ConfirmationTitle>
      {item.status === 'approved' && <Badge className="rounded-full bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200">Approved</Badge>}
      {item.status === 'declined' && <p>Declined or expired</p>}
      {item.status === 'pending' && !active && <p>Confirmation expired.</p>}
      <ConfirmationActions>{confirm && [false, true].map((approved) => <ConfirmationAction key={String(approved)} disabled={!!pending || !active} variant={approved ? 'default' : 'outline'} onClick={async () => {
        setPending(item.id); setError('');
        try { await confirm(job.id, item.id, approved); } catch { setError('Could not send confirmation. Refresh and try again.'); } finally { setPending(null); }
      }}>{approved ? 'Approve deletion' : 'Decline'}</ConfirmationAction>)}</ConfirmationActions>
    </Confirmation>)}
    {error && <p role="alert">{error}</p>}
    {!!job.sources?.length && <Sources><SourcesTrigger count={job.sources.length} /><SourcesContent>
      {job.sources.map((source) => <div key={source.id} id={`source-${job.id}-${source.id}`} className="space-y-2 rounded-lg border p-3">
        <strong>{source.title}</strong><span className="ml-2 text-xs text-muted-foreground">{source.scope === 'PERSONAL' ? 'Personal · Only you' : source.scope === 'ROOM' ? 'Room' : 'Organization'}</span>
        <p>{source.body}</p>
        {source.citations.map((citation, index) => <blockquote className="border-l-2 pl-3" key={index}><p>{citation.quote}</p><small>{citation.locator}{citation.documentVersionId ? ` · Version ${citation.documentVersionId}` : ''}</small></blockquote>)}
        <p className="text-xs text-muted-foreground">Finding updated {new Date(source.updatedAt).toLocaleString()}</p>
        <Source href={hubSourceUrl(source)} title="Open source" />
      </div>)}
    </SourcesContent></Sources>}
    {!!job.taskCommits?.length && <Task><TaskTrigger title="Kanban and Calendar changes" /><TaskContent>{job.taskCommits.map((commit, index) => <TaskItem key={`${commit.taskId}-${index}`}><a className="underline" href={`/kanban?task=${encodeURIComponent(commit.taskId)}`}>Task {commit.taskId.slice(0, 8)} · Revision {commit.revision}</a> · <a className="underline" href={`/calendar?task=${encodeURIComponent(commit.taskId)}`}>View calendar</a></TaskItem>)}</TaskContent></Task>}
    {job.commits?.map((commit) => <Checkpoint key={commit.versionId}><CheckpointIcon /><a className="shrink-0 underline" href={`/room-id=${encodeURIComponent(roomId ?? '')}?document=${encodeURIComponent(commit.documentId)}`}>Saved document · Version {commit.versionNumber}</a></Checkpoint>)}
    {job.reply && <CopyReply text={job.reply} />}
  </div>;
}
function CopyReply({ text }: { text: string }) {
  const [status, setStatus] = useState('');
  return <div><Button type="button" variant="ghost" size="sm" onClick={async () => { try { await navigator.clipboard.writeText(text); setStatus('Copied'); } catch { setStatus('Copy unavailable. Select the reply text to copy it.'); } }}>Copy response</Button><span role="status" className="ml-2 text-xs">{status}</span></div>;
}
