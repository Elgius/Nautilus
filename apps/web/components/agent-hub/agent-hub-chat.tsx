"use client";

import { useRef, useState, type FormEvent } from 'react';
import useSWR from 'swr';
import { ArrowUp, BookOpen, History, MessageSquarePlus, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { AgentPortrait } from '@/components/agents/agent-portrait';
import { PrivateAgentConversation } from '@/components/room/private-agent-conversation';
import { MessageScrollerProvider, MessageScroller, MessageScrollerViewport, MessageScrollerContent, MessageScrollerButton } from '@/components/ui/message-scroller';
import { flushRoomDocuments } from '@/lib/room-document-save';
import type { HubOptions, PrivateAgentJob, RoomAgentOption } from '../../../../shared/room-chat';
import './agent-hub.css';

export class HubRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
  get rejected() { return this.status >= 400 && this.status < 500 && this.status !== 408; }
}

export async function hubRequest<T>(organizationId: string, path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api/organizations/${encodeURIComponent(organizationId)}/agent-hub${path}`, {
    method, credentials: 'include', cache: 'no-store', ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new HubRequestError(data?.error ?? 'Agent Hub is unavailable. Please retry.', response.status);
  if (!data) throw new Error('The response was interrupted. Retry with the same instruction ID.');
  return data;
}
type HubRoom = { id: string; name: string; agents: { agent: RoomAgentOption }[] };
type Capabilities = { documents: boolean; knowledge: boolean; kanban: boolean; calendar: boolean; scheduling: boolean; execution: boolean };
export function AgentHubChat({ organizationId, userId }: { organizationId: string; userId: string }) {
  const [roomId, setRoomId] = useState('');
  const rooms = useSWR(['hub-rooms', organizationId, userId], () => hubRequest<{ rooms: HubRoom[] }>(organizationId, '/rooms'));
  const capabilities = useSWR(['hub-capabilities', organizationId, userId], () => hubRequest<Capabilities>(organizationId, '/capabilities'));
  const room = rooms.data?.rooms.find((item) => item.id === roomId) ?? rooms.data?.rooms[0];
  return <section className="agent-hub-tools" aria-label="Agent Hub chat">
    <header className="agent-hub-heading"><div><h2>Agent Hub</h2><p>Talk privately with your agents and work across documents, Kanban, and Calendar.</p></div>
      <label>Room<select aria-label="Agent Hub room" value={room?.id ?? ''} onChange={(event) => setRoomId(event.target.value)}><option value="" disabled>Choose a room</option>{rooms.data?.rooms.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    </header>
    {(rooms.error || capabilities.error) && <div role="alert"><p>Could not load Agent Hub.</p><Button variant="outline" onClick={() => { void rooms.mutate(); void capabilities.mutate(); }}>Retry loading Hub</Button></div>}
    {!rooms.data && !rooms.error && <p role="status">Loading your rooms…</p>}
    {rooms.data && !rooms.data.rooms.length && <p>Join a room to start a conversation with your agents.</p>}
    {room && <HubConversation key={`${organizationId}:${userId}:${room.id}`} organizationId={organizationId} userId={userId} room={room} capabilities={capabilities.data} />}
  </section>;
}

function storedConversation(key: string) {
  try { const id = sessionStorage.getItem(key); if (id) return id; } catch { /* session-only fallback */ }
  return crypto.randomUUID();
}
type PendingRun = HubOptions & { requestId: string; agentId: string; instruction: string };
function HubConversation({ organizationId, userId, room, capabilities }: { organizationId: string; userId: string; room: HubRoom; capabilities?: Capabilities }) {
  const [agentId, setAgentId] = useState(room.agents[0]?.agent.id ?? '');
  const agent = room.agents.find(({ agent }) => agent.id === agentId)?.agent;
  const storageKey = `hub-conversation:${organizationId}:${userId}:${room.id}:${agentId}`;
  const [conversationId, setConversationId] = useState(() => storedConversation(storageKey));
  const [reasoning, setReasoning] = useState<HubOptions['reasoning']>('medium');
  const [knowledge, setKnowledge] = useState<HubOptions['knowledge']>(['ORGANIZATION']);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState<PendingRun | null>(null);
  const [sending, setSending] = useState(false);
  const submitting = useRef(false);
  const [showHistory, setShowHistory] = useState(false);
  const history = useSWR(['hub-history', organizationId, userId, room.id], () => hubRequest<{ jobs: PrivateAgentJob[] }>(organizationId, `/rooms/${room.id}/history`), {
    refreshInterval: (data) => data?.jobs.some((job) => ['running', 'queued'].includes(job.status)) ? 800 : 4000,
  });
  const jobs = (history.data?.jobs ?? []).filter((job) => job.agentId === agentId && (showHistory || job.options?.conversationId === conversationId));
  const busy = jobs.some((job) => ['running', 'queued'].includes(job.status));
  function rememberConversation(id: string) { setConversationId(id); try { sessionStorage.setItem(storageKey, id); } catch { /* session-only fallback */ } }
  async function send(input: PendingRun) {
    if (submitting.current) return false;
    submitting.current = true; setSending(true); setError(''); setPending(input);
    try {
      await flushRoomDocuments(organizationId, room.id);
      await hubRequest(organizationId, `/rooms/${room.id}/runs`, 'POST', input);
      rememberConversation(input.conversationId!);
      setPending(null); setDraft((current) => current.trim() === input.instruction ? '' : current);
      await history.mutate().catch(() => setError('Instruction accepted, but its status could not be refreshed. Retry loading history.'));
      return true;
    } catch (err) {
      // Preserve the exact request only when acceptance is uncertain.
      if (err instanceof HubRequestError && err.rejected) setPending(null);
      setError(err instanceof Error ? err.message : 'Could not send the instruction.');
      return false;
    }
    finally { submitting.current = false; setSending(false); }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!agent || !draft.trim() || busy || !conversationId || pending) return;
    void send({ requestId: crypto.randomUUID(), agentId, instruction: draft.trim(), conversationId, knowledge, reasoning });
  }
  async function action(jobId: string, name: string, input: unknown = {}) { await hubRequest(organizationId, `/rooms/${room.id}/runs/${jobId}/${name}`, 'POST', input); await history.mutate(); }
  return <div className="agent-hub-conversation">
    <div className="agent-hub-toolbar">
      {agent && <AgentPortrait agent={agent} />}
      <label>Agent<select aria-label="Agent Hub agent" value={agentId} disabled={sending || !!pending} onChange={(event) => { setAgentId(event.target.value); setConversationId(storedConversation(`hub-conversation:${organizationId}:${userId}:${room.id}:${event.target.value}`)); setDraft(''); setShowHistory(false); }}><option value="" disabled>Choose an agent</option>{room.agents.map(({ agent }) => <option key={agent.id} value={agent.id}>{agent.name} · {agent.role}</option>)}</select></label>
      <Button variant="outline" size="sm" disabled={busy || sending || !!pending} onClick={() => { rememberConversation(crypto.randomUUID()); setShowHistory(false); setDraft(''); }}><MessageSquarePlus size={14} />New chat</Button>
      <Button variant="ghost" size="sm" aria-pressed={showHistory} onClick={() => setShowHistory((value) => !value)}><History size={14} />{showHistory ? 'Current chat' : 'History'}</Button>
    </div>
    <div className="agent-hub-capabilities" aria-label="Available capabilities"><span>Knowledge</span><span>Kanban and Calendar</span><span>Schedules</span><span>{capabilities?.documents ? 'Saved documents' : 'Document tools need Office and storage configuration'}</span></div>
    {capabilities && !capabilities.execution && <p role="status" className="px-4 text-sm">Agent execution is unavailable. The room coordinator needs to be configured.</p>}
    <MessageScrollerProvider autoScroll><MessageScroller className="agent-hub-scroller"><MessageScrollerViewport tabIndex={0} aria-label="Agent conversation"><MessageScrollerContent>
      {history.error && <p role="alert">Conversation could not be refreshed. <Button variant="ghost" size="sm" onClick={() => void history.mutate()}>Retry history</Button></p>}
      {!history.data && !history.error && <p role="status">Loading conversation…</p>}
      {!jobs.length && history.data && <div className="agent-hub-empty"><BookOpen /><h3>What should we work on?</h3><p>Find a saved document, look up team knowledge, or manage a task and its calendar date.</p><div>{['Find the saved documents in this room', 'What decisions are in our team knowledge?', 'Show my tasks and calendar dates'].map((prompt) => <Button key={prompt} type="button" size="sm" variant="outline" onClick={() => setDraft(prompt)}>{prompt}</Button>)}</div></div>}
      <PrivateAgentConversation full roomId={room.id} agents={room.agents.map(({ agent }) => agent)} jobs={jobs} canSend={!sending && !!capabilities?.execution} busy={busy} retry={async (agent, instruction) => send({ requestId: crypto.randomUUID(), agentId: agent.id, instruction, conversationId, knowledge, reasoning })}
        cancel={(id) => { void action(id, 'cancel').catch(() => setError('Could not cancel. Refresh and retry.')); }} confirm={(id, confirmationId, approved) => action(id, 'confirm', { confirmationId, approved })} />
      {showHistory && jobs.filter((job) => job.options?.conversationId && job.options.conversationId !== conversationId).map((job) => <Button key={job.id} variant="ghost" size="sm" disabled={busy} onClick={() => { rememberConversation(job.options!.conversationId!); setShowHistory(false); }}>Continue chat from {new Date(job.createdAt).toLocaleString()}</Button>)}
    </MessageScrollerContent></MessageScrollerViewport><MessageScrollerButton /></MessageScroller></MessageScrollerProvider>
    <form onSubmit={submit} className="agent-hub-composer">
      <fieldset disabled={sending || !!pending || busy} className="agent-hub-options"><legend className="sr-only">Conversation settings</legend>
        {(['ORGANIZATION', 'PERSONAL'] as const).map((scope) => <label key={scope}><input type="checkbox" checked={knowledge.includes(scope)} onChange={(event) => setKnowledge((current) => event.target.checked ? [...current, scope] : current.filter((item) => item !== scope))} />{scope === 'PERSONAL' ? 'Personal knowledge' : 'Organization knowledge'}</label>)}
        <label>Reasoning<select aria-label="Agent reasoning effort" value={reasoning} onChange={(event) => setReasoning(event.target.value as HubOptions['reasoning'])}>{['low', 'medium', 'high'].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      </fieldset>
      {knowledge.includes('PERSONAL') && <p className="text-sm text-muted-foreground">Personal knowledge stays in this private response. Disable it for shared changes or delegation.</p>}
      <Textarea aria-label="Agent Hub instruction" value={draft} maxLength={20000} disabled={sending || !!pending} placeholder={agent ? `Ask ${agent.name}…` : 'Create an agent to start'} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />
      <div className="agent-hub-send"><span>Only you can see this chat. Saved changes are shared with the room.</span><Button type="submit" disabled={!agent || !draft.trim() || !conversationId || sending || busy || !!pending || !capabilities?.execution}><ArrowUp size={15} />{sending ? 'Sending…' : 'Send'}</Button></div>
      {busy && <p role="status"><Square size={12} className="inline" /> Agent is working. You can cancel from its response.</p>}
      {error && <p role="alert">{error}</p>}
      {pending && !sending && <Button type="button" variant="outline" onClick={() => void send(pending)}>Retry sending instruction</Button>}
      <p className="text-xs text-muted-foreground">Enter to send · Shift + Enter for a new line. Agents use saved room content; local files stay on your device.</p>
    </form>
  </div>;
}
