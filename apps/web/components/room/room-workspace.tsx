"use client";

import { useCallback, useEffect, useRef, useState, useReducer, type FormEvent, type CSSProperties } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowUp, Bot, FileText, Link2, MessageSquare, Users, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { useWorkspaceSession } from "@/components/auth/workspace-session";
import { initials } from "@/lib/auth-types";
import { errorMessage } from "@/lib/auth-client";
import { roomRequest, type RoomDetail, type RoomMessage } from "@/lib/room-client";
import { RoomDocuments } from "./room-documents";
import { useRoomLayout } from "./use-room-layout";
import { clampChatWidth } from "@/lib/room-layout";
import { initialRoomFileState, roomFileReducer } from "@/lib/room-file-state";

export function RoomWorkspace({ initialData }: { initialData: RoomDetail }) {
  const { session } = useWorkspaceSession();
  const organizationId = session.activeOrganization!.id;
  const { room } = initialData;
  const [chatLayout, updateChatLayout] = useRoomLayout(session.user.id);
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const panels = useRef<HTMLElement>(null);
  const path = `/${encodeURIComponent(room.id)}`;
  const [messages, setMessages] = useState(initialData.messages);
  const [nextCursor, setNextCursor] = useState(initialData.nextCursor);
  const [draft, setDraft] = useState("");
  const [agentId, setAgentId] = useState(room.agents.length === 1 ? room.agents[0].agent.id : "");
  const [failedReply, setFailedReply] = useState<{ messageId: string; agentId: string } | null>(null);
  const [replying, setReplying] = useState(false);
  const [sending, setSending] = useState(false), [loadingOlder, setLoadingOlder] = useState(false);
  const [notice, setNotice] = useState("");
  const [mobilePanel, setMobilePanel] = useState<"chat" | "document">("chat");
  const [fileState, dispatchFiles] = useReducer(roomFileReducer, room.documents[0]?.id, initialRoomFileState);
  const [documentNavigation, setDocumentNavigation] = useState<HTMLDivElement | null>(null);
  const [documentActions, setDocumentActions] = useState<HTMLDivElement | null>(null);
  const [dirtyDocumentIds, setDirtyDocumentIds] = useState<Set<string>>(new Set());
  const onDocumentDirtyChange = useCallback((id: string, dirty: boolean) => {
    setDirtyDocumentIds((previous) => {
      const next = new Set(previous);
      if (dirty) next.add(id); else next.delete(id);
      return next;
    });
  }, []);
  const messageList = useRef<HTMLDivElement>(null);
  const previousLatest = useRef(messages.at(-1)?.id);
  useEffect(() => {
    const latest = messages.at(-1)?.id;
    if (latest !== previousLatest.current) messageList.current?.scrollTo({ top: messageList.current.scrollHeight, behavior: "smooth" });
    previousLatest.current = latest;
  }, [messages]);
  useEffect(() => {
    roomRequest(organizationId, `${path}/read`, 'POST', {}).catch(() => {});
  }, [organizationId, path]);
  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending || replying || !draft.trim()) return;
    setSending(true); setNotice('');
    try {
      const { message } = await roomRequest<{ message: RoomMessage }>(organizationId, `${path}/messages`, 'POST', {
        text: draft,
      });
      setMessages((previous) => [...previous, message]); setDraft('');
      if (agentId) await requestReply(message.id, agentId);
    } catch (error) { setNotice(errorMessage(error)); }
    finally { setSending(false); }
  }
  async function requestReply(messageId: string, selectedAgentId: string) {
    setReplying(true); setFailedReply(null); setNotice('');
    try {
      const { message } = await roomRequest<{ message: RoomMessage }>(organizationId,
        `${path}/messages/${encodeURIComponent(messageId)}/reply`, 'POST', { agentId: selectedAgentId });
      setMessages((previous) => [...previous, message]);
    } catch (error) {
      setFailedReply({ messageId, agentId: selectedAgentId });
      setNotice(`Your message is saved. ${errorMessage(error)}`);
    } finally { setReplying(false); }
  }
  async function loadOlder() {
    if (!nextCursor || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const result = await roomRequest<{ messages: RoomMessage[]; nextCursor: string | null }>(organizationId, `${path}/messages?before=${encodeURIComponent(nextCursor)}`);
      setMessages((previous) => [...result.messages, ...previous]); setNextCursor(result.nextCursor);
    } catch (error) { setNotice(errorMessage(error)); }
    finally { setLoadingOlder(false); }
  }
  async function copyLink() {
    try { await navigator.clipboard.writeText(window.location.href); setNotice('Room link copied.'); }
    catch { setNotice('Copy the room link from your address bar.'); }
  }
  return <div className="room-workspace">
    <header className="room-topbar">
      <div className="room-topbar-main">
      <div className="room-location"><Link href="/" className="room-back" aria-label="Back to workspace" onNavigate={(event) => {
        if (dirtyDocumentIds.size && !window.confirm('You have unsaved document changes. Leave this room and discard them?')) event.preventDefault();
      }}><ArrowLeft size={17} /></Link><BrandMark className="size-7" />
        <div className="room-identity"><h1>{room.name}</h1><span className="room-workspace-label">{session.activeOrganization?.name}</span></div>
      </div>
      <div className="room-header-actions"><Button className="room-chat-toggle" variant="ghost" size="sm" aria-controls="room-chat" aria-expanded={!chatLayout.collapsed} onClick={() => updateChatLayout({ ...chatLayout, collapsed: !chatLayout.collapsed })}>{chatLayout.collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}{chatLayout.collapsed ? "Show chat" : "Hide chat"}</Button><div className="room-participants" aria-label="Room participants">
        {room.members.map(({ member }) => <span key={member.user.id} title={member.user.name}>{initials(member.user.name)}</span>)}
        {room.agents.map(({ agent }) => <span key={agent.id} title={agent.name}><Bot size={14} /></span>)}
      </div><Button variant="outline" size="sm" onClick={copyLink} aria-label="Copy room link"><Link2 size={14} /><span>Copy link</span></Button></div>
      </div>
      <nav className="room-document-navbar" aria-label="Document navigation">
        <div className="room-document-navigation" ref={setDocumentNavigation} />
        <div className="room-document-actions" ref={setDocumentActions} />
      </nav>
    </header>
    <div className="room-mobile-tabs" role="tablist" aria-label="Room panels">
      <Button variant="ghost" size="sm" id="chat-tab" role="tab" aria-selected={mobilePanel === 'chat'} aria-controls="room-chat" onClick={() => setMobilePanel('chat')}><MessageSquare size={16} />Chat</Button>
      <Button variant="ghost" size="sm" id="document-tab" role="tab" aria-selected={mobilePanel === 'document'} aria-controls="room-document" onClick={() => setMobilePanel('document')}><FileText size={16} />Documents</Button>
    </div>
    <main ref={panels} className="room-panels" data-mobile-panel={mobilePanel} data-chat-collapsed={chatLayout.collapsed} style={{ '--room-chat-width': `${dragWidth ?? chatLayout.width}%` } as CSSProperties}>
      {chatLayout.collapsed && <div className="room-chat-rail"><Button variant="ghost" size="icon" aria-label="Expand room chat" title="Expand room chat" aria-controls="room-chat" aria-expanded={false} onClick={() => updateChatLayout({ ...chatLayout, collapsed: false })}><PanelLeftOpen size={16} /></Button></div>}
      <section className="room-chat-panel" id="room-chat" aria-label="Room chat">
        <div className="room-panel-heading"><div><MessageSquare size={16} /><h2>Room chat</h2></div><div className="room-chat-heading-actions"><span><Users size={13} />{room.members.length + room.agents.length} participants</span><Button className="room-chat-collapse" variant="ghost" size="icon-sm" aria-label="Collapse room chat" title="Collapse room chat" aria-controls="room-chat" aria-expanded={!chatLayout.collapsed} onClick={() => updateChatLayout({ ...chatLayout, collapsed: true })}><PanelLeftClose size={16} /></Button></div></div>
        <div className="room-messages" ref={messageList} role="log" aria-label="Conversation" aria-live="polite">
          {nextCursor && <Button variant="ghost" size="sm" onClick={loadOlder} disabled={loadingOlder}>{loadingOlder ? 'Loading…' : 'Load earlier messages'}</Button>}
          {!messages.length && <p className="room-local-note">Start the conversation with your team.</p>}
          {messages.map((message) => {
            const own = message.authorUserId === session.user.id, author = message.authorUser?.name || message.authorAgent?.name || 'Unknown author';
            return <article key={message.id} className={`room-message ${own ? 'is-own' : ''}`} aria-label={`${author}, ${new Date(message.createdAt).toLocaleString()}`}>
              <div className={`room-message-avatar ${message.authorAgent ? 'is-agent' : ''}`}>{message.authorAgent ? <Bot size={17} /> : initials(author)}</div>
              <div className="room-message-body"><div className="room-message-meta"><strong>{own ? 'You' : author}</strong>{message.authorAgent && <span className="room-agent-label">Agent</span>}<time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div>
                <Bubble variant={own ? 'default' : 'secondary'} align={own ? 'end' : 'start'}><BubbleContent className="whitespace-pre-wrap [overflow-wrap:anywhere]">{message.text}</BubbleContent></Bubble>
                {message.documents.map((attachment) => <Button variant="ghost" size="sm" key={attachment.documentId} className="room-document-reference" onClick={() => { dispatchFiles({ type: 'select', id: attachment.documentId }); setMobilePanel('document'); }}><FileText size={15} />{attachment.document.title}</Button>)}
              </div>
            </article>;
          })}
        </div>
        <div className="room-composer-area">
          {replying && <p className="room-local-note" role="status">Agent is replying…</p>}
          {failedReply && <Button variant="outline" size="sm" disabled={sending || replying} onClick={() => requestReply(failedReply.messageId, failedReply.agentId)}>Retry agent reply</Button>}
          <form className="room-composer" onSubmit={sendMessage} aria-busy={sending || replying}>
          {room.agents.length > 0 && <label className="room-agent-picker">Reply from
            <select aria-label="Agent to reply" value={agentId} disabled={sending || replying} onChange={(event) => setAgentId(event.target.value)}>
              <option value="">Team only</option>
              {room.agents.map(({ agent }) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
            </select>
          </label>}
          <textarea aria-label="Message to room" placeholder="Share an idea or add some context…" value={draft} disabled={sending} onChange={(event) => setDraft(event.target.value)} rows={3} maxLength={20000}
            onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />
          <div className="room-composer-footer"><span>Enter to send · Shift + Enter for a new line</span><Button size="icon" type="submit" disabled={sending || replying || !draft.trim()} aria-label="Send message"><ArrowUp size={17} /></Button></div>
        </form><p className="room-local-note">Messages are saved to your organisation.</p></div>
      </section>
      <div className="room-panel-resizer" role="separator" tabIndex={chatLayout.collapsed ? -1 : 0} aria-label="Resize room chat" aria-orientation="vertical" aria-valuemin={18} aria-valuemax={45} aria-valuenow={Math.round(dragWidth ?? chatLayout.width)}
        onPointerDown={(event) => { if (event.button === 0) { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); } }}
        onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId) && panels.current) { const bounds = panels.current.getBoundingClientRect(); setDragWidth(clampChatWidth((event.clientX - bounds.left) / bounds.width * 100)); } }}
        onPointerUp={(event) => { if (!event.currentTarget.hasPointerCapture(event.pointerId)) return; if (dragWidth !== null && panels.current) { const bounds = panels.current.getBoundingClientRect(); updateChatLayout({ ...chatLayout, width: clampChatWidth((event.clientX - bounds.left) / bounds.width * 100) }); } event.currentTarget.releasePointerCapture(event.pointerId); setDragWidth(null); }}
        onPointerCancel={() => setDragWidth(null)}
        onKeyDown={(event) => { const width = event.key === 'ArrowLeft' ? chatLayout.width - 2 : event.key === 'ArrowRight' ? chatLayout.width + 2 : event.key === 'Home' ? 18 : event.key === 'End' ? 45 : null; if (width === null) return; event.preventDefault(); updateChatLayout({ ...chatLayout, width: clampChatWidth(width) }); }} />
      <section className="room-document-panel" id="room-document" aria-label="Room documents">
        <RoomDocuments dirtyDocumentIds={dirtyDocumentIds} navigationContainer={documentNavigation} actionsContainer={documentActions} organizationId={organizationId} roomId={room.id} initialDocuments={room.documents} storageConfigured={initialData.storageConfigured} officeConfigured={initialData.officeConfigured} fileState={fileState} dispatchFiles={(action) => { dispatchFiles(action); if (action.type === 'add') setMobilePanel('document'); }} onSelect={(id) => { dispatchFiles({ type: 'select', id }); setMobilePanel('document'); }} onDirtyChange={onDocumentDirtyChange} />
      </section>
    </main>
    {notice && <div className="room-toast" role="status">{notice}<Button variant="ghost" size="sm" aria-label="Dismiss notification" onClick={() => setNotice('')}>×</Button></div>}
  </div>;
}
