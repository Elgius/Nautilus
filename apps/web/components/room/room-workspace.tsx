"use client";

import { useCallback, useRef, useState, useReducer, type CSSProperties } from "react";
import Link from "next/link";
import { ArrowLeft, Bot, FileText, Link2, MessageSquare, Users, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Message, MessageContent, MessageHeader } from "@/components/ui/message";
import { MessageScrollerProvider, MessageScroller, MessageScrollerViewport, MessageScrollerContent, MessageScrollerItem, MessageScrollerButton } from "@/components/ui/message-scroller";
import { RoomChatComposer } from "./room-chat-composer";
import { PrivateAgentConversation } from "./private-agent-conversation";
import { useWorkspaceSession } from "@/components/auth/workspace-session";
import { initials } from "@/lib/auth-types";
import { errorMessage } from "@/lib/auth-client";
import { roomRequest, type RoomDetail } from "@/lib/room-client";
import { useRoomChat } from "./use-room-chat";
import { useRoomSuggestions } from "./use-room-suggestions";
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
  const [joined, setJoined] = useState(room.members.some(({ member }) => member.user.id === session.user.id));
  const [joining, setJoining] = useState(false);
  const { agents, agentsLoading, agentJobs, loadAgents, invokeAgent, canSend, online, typing, reads, sendTyping, messages, pending, status, notice, setNotice, nextCursor, loadingOlder, loadOlder, sendMessage } = useRoomChat(organizationId, room.id, session.user.id, joined);
  const suggestions = useRoomSuggestions(organizationId, room.id, session.user.id, joined, messages);
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
  async function joinRoom() {
    setJoining(true);
    try {
      await roomRequest(organizationId, `/${encodeURIComponent(room.id)}/members`, 'POST', {});
      setJoined(true);
    } catch (error) { setNotice(errorMessage(error)); }
    finally { setJoining(false); }
  }
  async function copyLink() {
    try { await navigator.clipboard.writeText(window.location.href); setNotice('Room link copied.'); }
    catch { setNotice('Copy the room link from your address bar.'); }
  }
  const agentBusy = agentJobs.some((job) => job.status === "queued" || job.status === "running");
  const typingNames = Object.entries(typing).filter(([id]) => id !== session.user.id).map(([, user]) => user.name).join(', ');
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
        <div className="room-panel-heading"><div><MessageSquare size={16} /><h2>Room chat</h2></div><div className="room-chat-heading-actions"><span><Users size={13} />{online.length} online · {room.members.length + (joined && !room.members.some(({ member }) => member.user.id === session.user.id) ? 1 : 0)} members</span><Button className="room-chat-collapse" variant="ghost" size="icon-sm" aria-label="Collapse room chat" title="Collapse room chat" aria-controls="room-chat" aria-expanded={!chatLayout.collapsed} onClick={() => updateChatLayout({ ...chatLayout, collapsed: true })}><PanelLeftClose size={16} /></Button></div></div>
        <MessageScrollerProvider autoScroll>
        <MessageScroller className="room-chat-scroller">
        <MessageScrollerViewport className="room-messages" aria-label="Conversation" tabIndex={0}>
        <MessageScrollerContent className="room-chat-content" aria-label="Conversation messages" aria-live="polite">
          {nextCursor && <Button variant="ghost" size="sm" onClick={loadOlder} disabled={loadingOlder}>{loadingOlder ? 'Loading…' : 'Load earlier messages'}</Button>}
          {!messages.length && <div className="room-conversation-intro"><div className="room-intro-icon"><MessageSquare size={20} /></div><h3>A space to think together</h3><p>Share an idea or work through a document with the people in this room.</p></div>}
          {messages.map((message) => {
            const own = message.authorUserId === session.user.id, author = message.authorUser?.name || 'Unknown author';
            return <MessageScrollerItem key={message.id} messageId={message.id} scrollAnchor={Boolean(message.authorUserId)}>
              <Message align={own ? 'end' : 'start'} className={`room-message ${own ? 'is-own' : ''}`} aria-label={`${author}, ${new Date(message.createdAt).toLocaleString()}`}>
              <div className="room-message-avatar">{initials(author)}</div>
              <MessageContent className="room-message-body"><MessageHeader className="room-message-meta"><strong>{own ? 'You' : author}</strong><time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></MessageHeader>
                <Bubble variant={own ? 'muted' : 'ghost'} align={own ? 'end' : 'start'}><BubbleContent className="whitespace-pre-wrap [overflow-wrap:anywhere]">{message.text}</BubbleContent></Bubble>
                {own && <span className="room-message-meta">{Object.entries(reads).filter(([id, readAt]) => id !== session.user.id && readAt >= message.createdAt).length ? 'Seen' : 'Sent'}</span>}
                {message.documents.map((attachment) => <Button variant="ghost" size="sm" key={attachment.documentId} className="room-document-reference" onClick={() => { dispatchFiles({ type: 'select', id: attachment.documentId }); setMobilePanel('document'); }}><FileText size={15} />{attachment.document.title}</Button>)}
              </MessageContent>
            </Message></MessageScrollerItem>;
          })}
          {pending.map((message) => <MessageScrollerItem key={message.id} messageId={message.id}>
            <Message align="end"><MessageContent><Bubble variant="muted" align="end"><BubbleContent className="whitespace-pre-wrap [overflow-wrap:anywhere]">{message.text}</BubbleContent></Bubble>
              <p role="status">{message.status === 'pending' ? 'Sending…' : 'Message failed'}{message.status === 'failed' && <Button variant="ghost" size="sm" disabled={!canSend} onClick={() => sendMessage(message.text, message.id)}>Retry</Button>}</p>
            </MessageContent></Message>
          </MessageScrollerItem>)}
          <PrivateAgentConversation jobs={agentJobs} canSend={canSend} busy={agentBusy} retry={invokeAgent} />
        </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
        </MessageScroller>
        </MessageScrollerProvider>
        <div className="room-composer-area">
          {!joined && <Button variant="outline" size="sm" disabled={joining} onClick={joinRoom}>{joining ? 'Joining…' : 'Join room chat'}</Button>}
          <p role="status">{joined ? status : 'Join this room to chat with its members.'}{typingNames ? ` · ${typingNames} typing…` : ''}</p>
          <RoomChatComposer suggestions={suggestions} canSend={canSend} agents={agents} agentsLoading={agentsLoading} agentBusy={agentBusy} loadAgents={loadAgents} sendMessage={sendMessage} invokeAgent={invokeAgent} sendTyping={sendTyping} />
        </div>
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
