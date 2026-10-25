"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowUp, Bot, ChevronRight, FileText, Link2, MessageSquare, Users } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { useWorkspaceSession } from "@/components/auth/workspace-session";
import { initials } from "@/lib/auth-types";
import { errorMessage } from "@/lib/auth-client";
import { roomRequest, type RoomDetail, type RoomMessage } from "@/lib/room-client";
import { RoomDocuments } from "./room-documents";
import { isLocalRoomFileId } from "@/lib/local-room-files";

export function RoomWorkspace({ initialData }: { initialData: RoomDetail }) {
  const { session } = useWorkspaceSession();
  const organizationId = session.activeOrganization!.id;
  const { room } = initialData;
  const path = `/${encodeURIComponent(room.id)}`;
  const [messages, setMessages] = useState(initialData.messages);
  const [nextCursor, setNextCursor] = useState(initialData.nextCursor);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false), [loadingOlder, setLoadingOlder] = useState(false);
  const [notice, setNotice] = useState("");
  const [mobilePanel, setMobilePanel] = useState<"chat" | "document">("chat");
  const [selectedDocumentId, setSelectedDocumentId] = useState(room.documents[0]?.id);
  const [attachDocument, setAttachDocument] = useState(false);
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
    if (sending || !draft.trim()) return;
    setSending(true); setNotice('');
    try {
      const { message } = await roomRequest<{ message: RoomMessage }>(organizationId, `${path}/messages`, 'POST', {
        text: draft, documents: attachDocument && selectedDocumentId && !isLocalRoomFileId(selectedDocumentId) ? [{ documentId: selectedDocumentId }] : [],
      });
      setMessages((previous) => [...previous, message]); setDraft(''); setAttachDocument(false);
    } catch (error) { setNotice(errorMessage(error)); }
    finally { setSending(false); }
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
      <div className="room-location"><Link href="/" className="room-back" aria-label="Back to workspace" onNavigate={(event) => {
        if (dirtyDocumentIds.size && !window.confirm('You have unsaved document changes. Leave this room and discard them?')) event.preventDefault();
      }}><ArrowLeft size={17} /></Link><BrandMark className="size-7" />
        <span className="room-workspace-label">{session.activeOrganization?.name}</span><ChevronRight size={14} className="room-breadcrumb-divider" /><h1>{room.name}</h1>
      </div>
      <div className="room-header-actions"><div className="room-participants" aria-label="Room participants">
        {room.members.map(({ member }) => <span key={member.user.id} title={member.user.name}>{initials(member.user.name)}</span>)}
        {room.agents.map(({ agent }) => <span key={agent.id} title={agent.name}><Bot size={14} /></span>)}
      </div><Button variant="outline" size="sm" onClick={copyLink} aria-label="Copy room link"><Link2 size={14} /><span>Copy link</span></Button></div>
    </header>
    <div className="room-mobile-tabs" role="tablist" aria-label="Room panels">
      <Button variant="ghost" size="sm" id="chat-tab" role="tab" aria-selected={mobilePanel === 'chat'} aria-controls="room-chat" onClick={() => setMobilePanel('chat')}><MessageSquare size={16} />Chat</Button>
      <Button variant="ghost" size="sm" id="document-tab" role="tab" aria-selected={mobilePanel === 'document'} aria-controls="room-document" onClick={() => setMobilePanel('document')}><FileText size={16} />Documents</Button>
    </div>
    <main className="room-panels" data-mobile-panel={mobilePanel}>
      <section className="room-chat-panel" id="room-chat" aria-label="Room chat">
        <div className="room-panel-heading"><div><MessageSquare size={16} /><h2>Room chat</h2></div><span><Users size={13} />{room.members.length + room.agents.length} participants</span></div>
        <div className="room-messages" ref={messageList} role="log" aria-label="Conversation" aria-live="polite">
          {nextCursor && <Button variant="ghost" size="sm" onClick={loadOlder} disabled={loadingOlder}>{loadingOlder ? 'Loading…' : 'Load earlier messages'}</Button>}
          {!messages.length && <p className="room-local-note">Start the conversation with your team.</p>}
          {messages.map((message) => {
            const own = message.authorUserId === session.user.id, author = message.authorUser?.name || message.authorAgent?.name || 'Unknown author';
            return <article key={message.id} className={`room-message ${own ? 'is-own' : ''}`} aria-label={`${author}, ${new Date(message.createdAt).toLocaleString()}`}>
              <div className={`room-message-avatar ${message.authorAgent ? 'is-agent' : ''}`}>{message.authorAgent ? <Bot size={17} /> : initials(author)}</div>
              <div className="room-message-body"><div className="room-message-meta"><strong>{own ? 'You' : author}</strong>{message.authorAgent && <span className="room-agent-label">Agent</span>}<time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div>
                <Bubble variant={own ? 'default' : 'secondary'} align={own ? 'end' : 'start'}><BubbleContent className="whitespace-pre-wrap [overflow-wrap:anywhere]">{message.text}</BubbleContent></Bubble>
                {message.documents.map((attachment) => <Button variant="ghost" size="sm" key={attachment.documentId} className="room-document-reference" onClick={() => { setSelectedDocumentId(attachment.documentId); setMobilePanel('document'); }}><FileText size={15} />{attachment.document.title}</Button>)}
              </div>
            </article>;
          })}
        </div>
        <div className="room-composer-area"><form className="room-composer" onSubmit={sendMessage} aria-busy={sending}>
          <textarea aria-label="Message to room" placeholder="Share an idea or add some context…" value={draft} disabled={sending} onChange={(event) => setDraft(event.target.value)} rows={3} maxLength={20000}
            onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />
          <div className="room-composer-footer"><span>Enter to send · Shift + Enter for a new line</span><Button size="icon" type="submit" disabled={sending || !draft.trim()} aria-label="Send message"><ArrowUp size={17} /></Button></div>
          {selectedDocumentId && !isLocalRoomFileId(selectedDocumentId) && <label className="flex items-center gap-2 px-3 pb-2 text-xs"><input type="checkbox" checked={attachDocument} disabled={sending} onChange={(event) => setAttachDocument(event.target.checked)} />Attach selected document</label>}
        </form><p className="room-local-note">Messages are saved to your organisation.</p></div>
      </section>
      <section className="room-document-panel" id="room-document" aria-label="Room documents">
        <RoomDocuments organizationId={organizationId} roomId={room.id} initialDocuments={room.documents} storageConfigured={initialData.storageConfigured} officeConfigured={initialData.officeConfigured} selectedId={selectedDocumentId} onSelect={setSelectedDocumentId} onDirtyChange={onDocumentDirtyChange} />
      </section>
    </main>
    {notice && <div className="room-toast" role="status">{notice}<Button variant="ghost" size="sm" aria-label="Dismiss notification" onClick={() => setNotice('')}>×</Button></div>}
  </div>;
}
