"use client";

import { MAX_KNOWLEDGE_HOURS } from '../../../../shared/knowledge-schedule';
import { Input } from '@/components/ui/input';
import { useState } from 'react';
import { Pause, Play, RefreshCw } from 'lucide-react';
import { AgentPortrait } from '@/components/agents/agent-portrait';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { errorMessage } from '@/lib/auth-client';
import { knowledgeRequest, type KnowledgeAgent, type KnowledgeScope } from '@/lib/knowledge-client';

export function KnowledgeAgentDrawer({ agent, active, scope, organizationId, canManage, nextRefreshAt, refreshHours, onChange }: {
  agent: KnowledgeAgent; active: boolean; scope: KnowledgeScope; organizationId: string; canManage: boolean;
  nextRefreshAt: string; refreshHours: number; onChange: () => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [error, setError] = useState('');
  const [draft, setDraft] = useState<string | null>(null);
  const hours = Number(draft ?? refreshHours);
  const validHours = Number.isInteger(hours) && hours >= 1 && hours <= MAX_KNOWLEDGE_HOURS;
  const agentPath = '/agents/' + encodeURIComponent(agent.id);
  async function saveInterval(event: React.FormEvent) {
    event.preventDefault();
    if (!validHours || busy) return;
    setBusy(true);
    setNotice('');
    setError('');
    try {
      await knowledgeRequest(organizationId, agentPath, 'PATCH', { scope, refreshHours: hours });
      await onChange();
      setDraft(null);
      setNotice('Schedule saved.');
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  const status = active ? 'Active' : 'Rest';
  async function control(command: 'pause' | 'resume' | 'refresh') {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await knowledgeRequest<{ queued?: number }>(organizationId, agentPath, 'POST', { scope, command });
      await onChange();
      setNotice(command === 'refresh' ? (result.queued ? 'Refresh queued.' : 'No new checks to queue in assigned rooms.') : command === 'pause' ? 'Agent paused.' : 'Agent resumed.');
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  return <Sheet onOpenChange={open => { if (open) { setDraft(null); setNotice(''); setError(''); } }}>
    <SheetTrigger aria-label={agent.name + ', ' + status} title={agent.name} className="flex min-w-14 cursor-pointer flex-col items-center gap-2 rounded-md p-1 outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring">
      <AgentPortrait agent={agent} />
      <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-xs text-foreground">
        <span aria-hidden="true" className={'size-1.5 rounded-full ' + (active ? 'bg-primary' : 'bg-muted-foreground')} />{status}
      </span>
    </SheetTrigger>
    <SheetContent className="gap-6 overflow-y-auto p-6">
      <SheetHeader className="gap-3 p-0 pr-6"><AgentPortrait agent={agent} /><SheetTitle>{agent.name}</SheetTitle>
        <SheetDescription className="leading-relaxed">Checks tagged sources in assigned rooms for {scope === 'PERSONAL' ? 'your personal' : 'organization'} knowledge.</SheetDescription>
      </SheetHeader>
      <div className="grid gap-2 border-y py-5"><p className="font-medium">{status} · Checks every {refreshHours === 1 ? 'hour' : refreshHours + ' hours'}</p>
        <p className="text-muted-foreground">{active ? 'Next check: ' + new Date(nextRefreshAt).toLocaleString() : 'Scheduled checks are paused.'}</p>
      </div>
      {canManage && <form onSubmit={saveInterval} className="grid gap-2">
        <label htmlFor={'interval-' + agent.id} className="font-medium">Check interval (hours)</label>
        <div className="flex gap-2">
          <Input id={'interval-' + agent.id} type="number" min={1} max={MAX_KNOWLEDGE_HOURS} step={1} required disabled={busy}
            aria-invalid={!validHours} aria-describedby={'interval-help-' + agent.id} value={draft ?? refreshHours} onChange={event => setDraft(event.target.value)} />
          <Button type="submit" variant="outline" disabled={busy || !validHours || hours === refreshHours}>Save interval</Button>
        </div>
        <p id={'interval-help-' + agent.id} className={validHours ? 'text-xs text-muted-foreground' : 'text-xs text-destructive'}>Enter a whole number from 1 to {MAX_KNOWLEDGE_HOURS}.</p>
      </form>}
      <div className="flex flex-wrap gap-2"><Button disabled={!active || busy} onClick={() => void control('refresh')}><RefreshCw />Refresh now</Button>
        {canManage && <Button variant="outline" disabled={busy} onClick={() => void control(active ? 'pause' : 'resume')}>{active ? <Pause /> : <Play />}{active ? 'Pause agent' : 'Resume agent'}</Button>}
      </div>
      {notice && <p role="status">{notice}</p>}{error && <p role="alert" className="text-destructive">{error}</p>}
    </SheetContent>
  </Sheet>;
}
