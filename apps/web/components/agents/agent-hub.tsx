"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, ArrowUpRight, Bot, Ghost, Hash, MessageCircle, Plus, Search, Settings2, X } from "lucide-react";
import { Message as ChatMessage } from "@/components/ui/message";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { hubFetch, HubSessionChanged, importHubHistory, type HubPage, type HubSummary, type HubTurn } from "@/lib/hub-history";
import { AgentPortrait } from "./agent-portrait";
import { Button } from "@/components/ui/button";
import type { Agent } from "@/lib/agent-data";
import type { Room } from "@/lib/room-data";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AgentReply } from "@/components/room/private-agent-conversation";
import "./agent-hub.css";
import { AgentHubChat } from "@/components/agent-hub/agent-hub-chat";

type Message = { role: "user" | "assistant"; content: string };
type Thread = { retry?: { prompt: string; id: string }; draft: string; pending: string; error: string };
const empty: Thread = { draft: "", pending: "", error: "" };

function chatContext(messages: Message[]) {
  let length = 0;
  let start = messages.length;
  while (start > 0 && messages.length - start < 50) {
    length += messages[start - 1].content.length;
    if (length > 32000) break;
    start--;
  }
  return messages.slice(start);
}

type HubProps = {
  userId: string; organizationId: string; agents: Agent[]; rooms: Room[]; onCreate: () => void;
  onEdit: (id: string) => void; onCreateRoom: (id: string) => void; onOpenRoom: (room: Room) => void;
};

export function AgentHub(props: HubProps) {
  const [roomTools, setRoomTools] = useState(false);
  const [roomToolsMounted, setRoomToolsMounted] = useState(false);
  const [changed, setChanged] = useState(false);
  const onSessionChanged = useCallback(() => setChanged(true), []);
  if (changed) return <section role="alert">Your session changed. <Button onClick={() => window.location.reload()}>Reload workspace</Button></section>;
  return <>
    <div role="group" aria-label="Agent hub workspace" className="flex gap-2 mb-3">
      <Button variant={roomTools ? "ghost" : "secondary"} aria-pressed={!roomTools} onClick={() => setRoomTools(false)}>Private conversations</Button>
      <Button variant={roomTools ? "secondary" : "ghost"} aria-pressed={roomTools} onClick={() => { setRoomToolsMounted(true); setRoomTools(true); }}>Room tools</Button>
    </div>
    <div hidden={roomTools}><HubWorkspace {...props} onSessionChanged={onSessionChanged} /></div>
    {roomToolsMounted && <div hidden={!roomTools}><AgentHubChat organizationId={props.organizationId} userId={props.userId} /></div>}
  </>;
}

function HubWorkspace({ userId, organizationId, agents, rooms, onCreate, onEdit, onCreateRoom, onOpenRoom, onSessionChanged }: HubProps & { onSessionChanged: () => void }) {
  const [selected, setSelected] = useState("");
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [threads, setThreads] = useState<Record<string, Thread>>({});
  const requests = useRef(new Map<string, AbortController>());
  const scroll = useRef<HTMLDivElement>(null);
  const [reload, setReload] = useState(0);
  const [summaries, setSummaries] = useState<HubSummary[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [after, setAfter] = useState<string | null>(null);
  const [paging, setPaging] = useState(false);
  const [historyReady, setHistoryReady] = useState(false);
  const [storageError, setStorageError] = useState("");
  const [choices, setChoices] = useState<Record<string, string | null>>({});
  const [transcript, setTranscript] = useState<{ id: string; lastId: string; turns: HubTurn[] } | null>(null);
  const agent = agents.find((item) => item.id === selected) ?? agents[0];
  const url = `/api/organizations/${encodeURIComponent(organizationId)}/agent-hub-history`;
  // Pin the initial selection once, including an empty conversation for a new agent.
  if (historyReady && agent && choices[agent.id] === undefined) {
    setChoices({ ...choices, [agent.id]: summaries.find((item) => item.agentId === agent.id)?.id ?? null });
  }
  const conversationId = choices[agent?.id];
  const summary = summaries.find((item) => item.id === conversationId);
  const lastId = summary?.lastId;
  const turns = transcript?.id === conversationId ? transcript?.turns ?? [] : [];
  const transcriptReady = !summary || (transcript?.id === conversationId && transcript?.lastId === lastId);
  const thread = threads[conversationId ?? agent?.id] ?? empty;
  const messages: Message[] = turns.flatMap((turn) => [{ role: "user", content: turn.prompt }, { role: "assistant", content: turn.reply }]);
  if (thread.pending) messages.push({ role: "user", content: thread.pending });

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const warning = after ? "" : await importHubHistory(url, userId, organizationId, controller.signal);
        const response = await hubFetch(url + (after ? `?after=${encodeURIComponent(after)}` : ""), userId, { signal: controller.signal });
        if (!response.ok) throw new Error();
        const page: HubPage = await response.json();
        if (controller.signal.aborted) return;
        setSummaries((previous) => {
          const items = new Map(previous.map((item) => [item.id, item]));
          for (const item of page.summaries) {
            if ((items.get(item.id)?.updatedAt ?? 0) <= item.updatedAt) items.set(item.id, item);
          }
          return [...items.values()].sort((a, b) => b.updatedAt - a.updatedAt || b.id.localeCompare(a.id));
        });
        setNext(page.next);
        setStorageError(warning);
        setHistoryReady(true);
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof HubSessionChanged) onSessionChanged();
        else setStorageError("Couldn’t load saved conversations.");
      } finally { if (!controller.signal.aborted) setPaging(false); }
    }
    void load();
    const refresh = () => { setAfter(null); setReload((value) => value + 1); };
    window.addEventListener("focus", refresh);
    return () => { controller.abort(); window.removeEventListener("focus", refresh); };
  }, [after, url, organizationId, userId, reload, onSessionChanged]);

  useEffect(() => {
    if (!conversationId || !lastId || transcriptReady) return;
    const controller = new AbortController();
    async function loadTranscript(id: string, version: string) {
      try {
        const response = await hubFetch(`${url}/${id}`, userId, { signal: controller.signal });
        if (!response.ok) throw new Error();
        const data: { turns: HubTurn[] } = await response.json();
        if (!controller.signal.aborted) setTranscript({ id, lastId: version, turns: data.turns });
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof HubSessionChanged) onSessionChanged();
        else setStorageError("Couldn’t load this conversation.");
      }
    }
    void loadTranscript(conversationId, lastId);
    return () => controller.abort();
  }, [conversationId, lastId, transcriptReady, url, userId, onSessionChanged, reload]);
  const visible = agents.filter((item) => (item.name + " " + item.role).toLowerCase().includes(query.toLowerCase().trim()));
  const assigned = rooms.filter((room) => room.agentIds.includes(agent?.id));

  useEffect(() => {
    const active = requests.current;
    return () => { for (const request of active.values()) request.abort(); };
  }, []);
  useEffect(() => {
    if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [conversationId, messages.length, thread.pending]);

  function update(id: string, change: Partial<Thread>) {
    setThreads((previous) => ({ ...previous, [id]: { ...(previous[id] ?? empty), ...change } }));
  }
  async function send(text: string) {
    const content = text.trim();
    if (!agent || !content || !historyReady || !transcriptReady) return;
    const id = conversationId ?? crypto.randomUUID();
    if (requests.current.has(id)) return;
    setChoices((previous) => ({ ...previous, [agent.id]: id }));
    const controller = new AbortController();
    requests.current.set(id, controller);
    const turnId = thread.retry?.prompt === content ? thread.retry.id : crypto.randomUUID();
    const context: Message[] = [...messages, { role: "user", content }];
    update(id, { draft: "", pending: content, error: "" });
    try {
      const response = await hubFetch(`/api/organizations/${encodeURIComponent(organizationId)}/agents/${encodeURIComponent(agent.id)}/chat`, userId, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ messages: chatContext(context), history: { id: turnId, conversationId: id } }), signal: controller.signal,
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || result?.turn?.id !== turnId) {
        throw new Error(result?.error || "The agent couldn’t reply. Try sending again.");
      }
      const turn: HubTurn = result.turn;
      setTranscript((current) => {
        if (current && current.id !== id) return current;
        const updated = (current?.turns ?? turns).filter((item) => item.id !== turn.id);
        return { id, lastId: turn.id, turns: [...updated, turn] };
      });
      setSummaries((previous) => [{ id, agentId: agent.id, title: summary?.title ?? content.slice(0, 160),
        preview: turn.reply.slice(0, 160), updatedAt: turn.createdAt, lastId: turn.id }, ...previous.filter((item) => item.id !== id)]);
      update(id, { pending: "", retry: undefined });
    } catch (error) {
      if (error instanceof HubSessionChanged) { onSessionChanged(); return; }
      if (!controller.signal.aborted) update(id, { retry: { prompt: content, id: turnId }, draft: text, pending: "", error: error instanceof Error ? error.message : "Couldn’t send message." });
    } finally { requests.current.delete(id); }
  }

  function choice(item: Agent, compact: boolean) {
    return <button key={item.id} className={compact ? "hub-row" : "hub-tile"} aria-pressed={item.id === agent?.id} onClick={() => setSelected(item.id)}>
      <AgentPortrait agent={item} /><span><strong>{item.name}</strong>{compact && <small>{item.role}</small>}</span>
    </button>;
  }

  return <section className="agent-hub" aria-label="Agent hub">
    <aside className="hub-rail">
      <header><h1>Agent hub</h1><Button variant="ghost" size="icon-sm" aria-label={searching ? "Close agent search" : "Search agents"} onClick={() => { setSearching(!searching); setQuery(""); }}>{searching ? <X /> : <Search />}</Button>
        <Button variant="outline" size="icon-sm" aria-label="Create agent" title="Create agent" onClick={onCreate}><Plus /></Button></header>
      {searching && <input autoFocus type="search" aria-label="Search agents" placeholder="Search agents…" value={query} onChange={(event) => setQuery(event.target.value)} />}
      <div className="hub-roster"><div className="hub-tiles">{visible.slice(0, 3).map((item) => choice(item, false))}</div>
        {visible.slice(3).map((item) => choice(item, true))}
        {!visible.length && <p>{agents.length ? "No matching agents." : "No agents yet."}</p>}
      </div>
      <section className="hub-recent" aria-label="Conversation history">
        <div className="hub-recent-heading">
          <Button variant="ghost" size="sm" disabled={!agent || !historyReady} onClick={() => {
            const id = crypto.randomUUID();
            setChoices((previous) => ({ ...previous, [agent.id]: id }));
          }}><Plus />New chat</Button>
        </div>
        <div className="hub-recent-list">
          {summaries.map((item) => {
            const owner = agents.find((owner) => owner.id === item.agentId);
            if (!owner) return null;
            return <Button key={item.id} variant="ghost" className="hub-recent-item" title={item.title} aria-label={`${owner.name} · ${item.title}`} aria-current={conversationId === item.id ? "true" : undefined}
              onClick={() => { setSelected(owner.id); setChoices((previous) => ({ ...previous, [owner.id]: item.id })); }}>
              <AgentPortrait agent={owner} /><span><strong>{owner.name}</strong><small>{item.preview}</small></span>
            </Button>;
          })}
          {!summaries.some((item) => agents.some((owner) => owner.id === item.agentId)) && (historyReady ? <div className="hub-empty-history" role="img" aria-label="No conversation history"><Ghost size={30} strokeWidth={1.4} aria-hidden="true" /></div> : !storageError && <p>Loading conversations…</p>)}
        </div>
        {next && <Button variant="ghost" size="sm" disabled={paging} onClick={() => { setPaging(true); setAfter(next); }}>Load more conversations</Button>}
        {storageError && <div role="alert">{storageError} <Button variant="ghost" size="sm" onClick={() => setReload((value) => value + 1)}>Retry</Button></div>}
      </section>
    </aside>
    {agent ? <div className="hub-chat">
      <header className="hub-header"><span className="hub-identity"><AgentPortrait agent={agent} small /><strong>{agent.name}</strong></span>
        <DropdownMenu><DropdownMenuTrigger render={<Button variant="outline" size="icon-sm" aria-label="Agent settings and rooms" />}><Settings2 /></DropdownMenuTrigger>
          <DropdownMenuContent align="end"><DropdownMenuItem onClick={() => onEdit(agent.id)}><Settings2 />Customize agent</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>Assigned rooms</DropdownMenuLabel>
              {assigned.map((room) => <DropdownMenuItem key={room.id} onClick={() => onOpenRoom(room)}><Hash />{room.name}</DropdownMenuItem>)}
              <DropdownMenuItem onClick={() => onCreateRoom(agent.id)}><Plus />Start a room</DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent></DropdownMenu>
      </header>
      <div className="hub-history" ref={scroll} aria-label={`Conversation with ${agent.name}`} tabIndex={0}>
        {!transcriptReady && !storageError && <p role="status">Loading conversation…</p>}
        {transcriptReady && !messages.length && <div className="hub-welcome"><AgentPortrait agent={agent} animated /><h2>{agent.name}</h2><p>{agent.role}</p>
          <button disabled={!historyReady} onClick={() => void send("What can you help me with?")}><MessageCircle size={15} />What can you help me with?<ArrowUpRight size={14} /></button></div>}
        {messages.map((message, index) => <ChatMessage key={index} align={message.role === "user" ? "end" : "start"}>
          <Bubble variant={message.role === "user" ? "default" : "muted"}><BubbleContent className="hub-message-content">
            {message.role === "assistant" ? <AgentReply text={message.content} /> : <span className="whitespace-pre-wrap">{message.content}</span>}
          </BubbleContent></Bubble></ChatMessage>)}
        {thread.pending && <div className="hub-thinking" role="status"><AgentPortrait agent={agent} small />Thinking…</div>}
      </div>
      <div className="hub-compose-wrap">{thread.error && <p role="alert">{thread.error}</p>}
        <form className="hub-composer" onSubmit={(event) => { event.preventDefault(); void send(thread.draft); }}>
          <textarea rows={1} maxLength={32000} disabled={!!thread.pending || !historyReady || !transcriptReady} aria-label={`Message ${agent.name}`} placeholder={`Message ${agent.name}…`} value={thread.draft}
            onChange={(event) => update(conversationId ?? agent.id, { draft: event.target.value })} onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); }
            }} />
          <Button type="submit" size="icon-sm" disabled={!historyReady || !transcriptReady || !!thread.pending || !thread.draft.trim()} aria-label="Send message"><ArrowUp /></Button>
        </form>
      </div>
    </div> : <div className="hub-welcome"><Bot size={42} /><h2>Create your first agent</h2><Button onClick={onCreate}><Plus />Create agent</Button></div>}
  </section>;
}
