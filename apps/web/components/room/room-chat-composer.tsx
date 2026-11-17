"use client";

import { ChoiceMenu } from "@/components/ui/choice-menu";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ArrowUp, Brain, FileText, LockKeyhole, Plus, X } from "lucide-react";
import { RoomChatEditor, type RoomChatEditorHandle } from "./room-chat-editor";
import { RoomAgentAvatar } from "./room-agent-avatar";
import { InputBox } from "./input-box";
import { Button } from "@/components/ui/button";
import { Attachment, AttachmentAction, AttachmentContent, AttachmentDescription, AttachmentMedia, AttachmentTitle } from "@/components/ui/attachment";
import { InputGroup, InputGroupAddon, InputGroupButton } from "@/components/ui/input-group";
import { agentMention, selectAgentMention } from "@/lib/agent-mention";
import { defaultRoomSuggestions } from "./use-room-suggestions";
import { withDocumentSelection, type DocumentSelection } from '@/lib/document-selection';
import type { ChatUser, AgentQuestion, HubOptions, AgentRunMode, RoomAgentOption } from "../../../../shared/room-chat";

type Props = {
  members?: ChatUser[];
  preferenceKey?: string;
  selection?: DocumentSelection | null;
  onClearSelection?: (expected?: DocumentSelection) => void;
  suggestions?: string[];
  pendingQuestion?: { question: AgentQuestion; agentName: string; ready: boolean; sending: boolean; onAnswer: (answer: string) => void };
  canSend: boolean;
  agents: RoomAgentOption[];
  agentsLoading: boolean;
  agentBusy: boolean;
  sendMessage: (text: string, recipientUserId: string) => boolean;
  invokeAgent: (agent: RoomAgentOption, instruction: string, mode?: AgentRunMode, options?: Pick<HubOptions, 'knowledge' | 'reasoning'>) => boolean | Promise<boolean>;
  sendTyping: (recipientUserId: string) => void;
};
const reasoningLevels = ["Low", "Medium", "High"];

export function RoomChatComposer({ members = [], preferenceKey, selection, onClearSelection, suggestions = defaultRoomSuggestions, pendingQuestion, canSend, agents, agentsLoading, agentBusy, sendMessage, invokeAgent, sendTyping }: Props) {
  const [submitError, setSubmitError] = useState("");
  const [preparing, setPreparing] = useState(false);
  const submitting = useRef(false);
  const [draft, setDraft] = useState("");
  const [agentId, setAgentId] = useState(() => {
    try { return preferenceKey ? window.localStorage.getItem(preferenceKey) ?? '' : ''; } catch { return ''; }
  });
  const selected = agents.find(agent => agent.id === agentId) ?? (agents.length === 1 ? agents[0] : null);
  const [recipient, setRecipient] = useState<ChatUser | null>(null);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [reasoning, setReasoning] = useState("Medium");
  const [mode, setMode] = useState<AgentRunMode>('write');
  const [deferredQuestionId, setDeferredQuestionId] = useState<string | null>(null);
  const questionOpen = Boolean(pendingQuestion && pendingQuestion.question.id !== deferredQuestionId);
  const editor = useRef<RoomChatEditorHandle>(null);
  useEffect(() => { if (!questionOpen) editor.current?.focus(); }, [selected, questionOpen]);
  const fileInput = useRef<HTMLInputElement>(null);
  // Original Files stay in memory, separate from room documents and message payloads.
  const [attachments, setAttachments] = useState<{ id: string; file: File }[]>([]);
  const listId = useId();
  const attachmentNoteId = useId();
  const mention = recipient ? null : agentMention(draft);
  const matches = members.filter((agent) => agent.name.toLocaleLowerCase().startsWith(mention?.query.toLocaleLowerCase() ?? ""));
  const pickerOpen = Boolean(mention && !dismissed);
  const activeIndex = Math.min(active, Math.max(0, matches.length - 1));
  function select(agent: ChatUser) {
    const result = selectAgentMention(draft, agent.name);
    setDraft([result.roomDraft, result.instruction].filter(Boolean).join(" ")); setRecipient(agent); setDismissed(false);
    editor.current?.focus();
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (questionOpen || !canSend || attachments.length || submitting.current) return;
    if (!draft.trim() || mention || (!recipient && !selected)) return;
    const sentSelection = selection;
    const text = withDocumentSelection(draft, sentSelection, !recipient);
    if (text.length > 20000) { setSubmitError('Message and selected excerpt exceed 20,000 characters. Shorten the message or remove the excerpt.'); return; }
    setSubmitError('');
    if (!recipient && selected) {
      if (agentBusy) return;
      submitting.current = true; setPreparing(true);
      const sentInstruction = draft;
      try {
        if (await invokeAgent(selected, text, mode, { knowledge: ['ORGANIZATION'], reasoning: reasoning.toLowerCase() as HubOptions['reasoning'] })) {
          setDraft((current) => current === sentInstruction ? '' : current);
          if (sentSelection) onClearSelection?.(sentSelection);
        }
      } finally { submitting.current = false; setPreparing(false); }
    } else if (recipient && sendMessage(text, recipient.id)) {
      setDraft(""); setRecipient(null);
      if (sentSelection) onClearSelection?.(sentSelection);
    }
  }
  function keyDown(event: KeyboardEvent, inList: boolean) {
    if (event.isComposing) return;
    if (pickerOpen && ["ArrowDown", "ArrowUp", "Escape", "Enter", "Tab"].includes(event.key)) {
      if (event.key === 'Escape') { event.preventDefault(); setDismissed(true); return; }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault(); setActive((activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + Math.max(1, matches.length)) % Math.max(1, matches.length)); return;
      }
      if (matches.length && !event.shiftKey) { event.preventDefault(); select(matches[activeIndex]); return; }
      if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); return; }
    }
    if (event.key === 'Enter' && !event.shiftKey && !inList) {
      event.preventDefault();
      (event.target as HTMLElement).closest('form')?.requestSubmit();
    }
  }

  return <>
    {pendingQuestion && <div hidden={!questionOpen}>
      <InputBox key={pendingQuestion.question.id} question={pendingQuestion.question} agentName={pendingQuestion.agentName}
        pending={pendingQuestion.sending} disabled={!canSend || agentBusy || !pendingQuestion.ready || pendingQuestion.sending}
        onAnswer={pendingQuestion.onAnswer} onLater={() => setDeferredQuestionId(pendingQuestion.question.id)} />
    </div>}
    {pendingQuestion && !questionOpen && <Button type="button" size="sm" variant="outline" onClick={() => setDeferredQuestionId(null)}>Answer agent question</Button>}
    <div hidden={questionOpen}>
    <form onSubmit={submit} className="room-prompt-form">
    <div role="group" aria-label="Suggested prompts" className="room-chat-suggestions scroll-fade-x">
      {suggestions.map((suggestion) => <Button key={suggestion} type="button" variant="outline" size="sm" className="shrink-0" onClick={() => {
        // UI preview only: suggestions edit the current draft without sending or typing events.
        setDraft(suggestion);
        setDismissed(false); editor.current?.focus();
      }}>{suggestion}</Button>)}
    </div>
    <input ref={fileInput} type="file" multiple hidden aria-label="Choose local attachments" onChange={(event) => {
      const files = Array.from(event.currentTarget.files ?? []).map((file) => ({ id: crypto.randomUUID(), file }));
      setAttachments((previous) => [...previous, ...files]);
      event.currentTarget.value = "";
      editor.current?.focus();
    }} />
    {pickerOpen && <div id={listId} role="listbox" aria-label="Choose a room member" className="room-agent-options">
      {matches.length ? matches.map((agent, index) =>
        <button key={agent.id} id={`${listId}-${index}`} type="button" role="option" aria-selected={index === activeIndex} onMouseDown={(event) => event.preventDefault()} onClick={() => select(agent)}>
          <span className="room-agent-option-label"><strong>{agent.name}</strong>{matches.some(other => other.id !== agent.id && other.name === agent.name) && <small>{agent.id}</small>}</span><LockKeyhole size={13} />
        </button>) : <p role="status">{members.length ? 'No matching room member.' : 'No other room members.'}</p>}

    </div>}
    <InputGroup className="room-composer">
      {selection && <InputGroupAddon align="block-start" className="room-selection-quote" aria-label="Selected document excerpt">
        <div className="min-w-0 flex-1 border-l-2 border-primary pl-3">
          <p className="truncate text-xs font-medium" title={`${selection.title} · ${selection.location}`}>{selection.title} · {selection.location}</p>
          <blockquote className="mt-1 line-clamp-3 whitespace-pre-wrap break-words text-sm text-muted-foreground">{selection.text}</blockquote>
          {selection.truncated && <p className="text-xs text-muted-foreground">Excerpt shortened</p>}
        </div>
        <InputGroupButton size="icon-sm" variant="ghost" aria-label="Remove selected excerpt" onClick={() => onClearSelection?.()}><X size={14} /></InputGroupButton>
      </InputGroupAddon>}
      {attachments.length > 0 && <InputGroupAddon align="block-start" className="room-prompt-attachments" aria-label="Local attachments">
        {attachments.map(({ id, file }) => <Attachment key={id}>
          <AttachmentMedia><FileText size={16} /></AttachmentMedia>
          <AttachmentContent><AttachmentTitle title={file.name}>{file.name}</AttachmentTitle><AttachmentDescription>Local only · {file.size < 1024 ? `${file.size} B` : file.size < 1024 * 1024 ? `${Math.ceil(file.size / 1024)} KB` : `${(file.size / (1024 * 1024)).toFixed(1)} MB`}</AttachmentDescription></AttachmentContent>
          <AttachmentAction aria-label={`Remove ${file.name}`} onClick={() => setAttachments((previous) => previous.filter((attachment) => attachment.id !== id))}><X size={13} /></AttachmentAction>
        </Attachment>)}
      </InputGroupAddon>}
      {recipient && <InputGroupAddon align="block-start" className="room-private-target"><strong>To @{recipient.name}</strong><Button type="button" size="icon-sm" variant="ghost" aria-label="Remove recipient" onClick={() => { setRecipient(null); editor.current?.focus(); }}><X size={14} /></Button></InputGroupAddon>}
      <RoomChatEditor ref={editor}
        attributes={{
          'aria-label': recipient ? `Message to ${recipient.name}` : selected ? `Private instruction to ${selected.name}` : 'Agent message',
          'aria-placeholder': recipient ? `Message ${recipient.name}…` : 'Message your agent, or type @ for a person…',
          ...(attachments.length ? { 'aria-describedby': attachmentNoteId } : {}),
          role: 'combobox', 'aria-autocomplete': 'list', 'aria-expanded': String(pickerOpen),
          ...(pickerOpen ? { 'aria-controls': listId } : {}),
          ...(pickerOpen && matches.length ? { 'aria-activedescendant': `${listId}-${activeIndex}` } : {}),
        }}
        value={draft} onChange={(next) => {
          setDraft(next); setActive(0); setDismissed(false);
          if (recipient) sendTyping(recipient.id);
        }} onKeyDown={keyDown} />
      <InputGroupAddon align="block-end" className="room-composer-footer flex-wrap">
        {!recipient && selected && <div role="group" aria-label="Agent request mode" className="flex shrink-0">
          <Button type="button" size="xs" variant={mode === 'read' ? 'secondary' : 'ghost'} aria-pressed={mode === 'read'} disabled={preparing} onClick={() => setMode('read')}>Ask</Button>
          <Button type="button" size="xs" variant={mode === 'write' ? 'secondary' : 'ghost'} aria-pressed={mode === 'write'} disabled={preparing} onClick={() => setMode('write')}>Work</Button>
        </div>}
        <InputGroupButton variant="outline" size="icon-sm" className="rounded-full" aria-label="Attach files" title="Attach files · local preview only" onClick={() => fileInput.current?.click()}><Plus size={17} /></InputGroupButton>
        {selected && !recipient && <RoomAgentAvatar agent={selected} />}
        <ChoiceMenu label="Personal agent" className="room-reasoning-trigger max-w-36" value={selected?.id ?? ''}
          placeholder={agentsLoading ? 'Loading agents…' : agents.length ? 'Choose agent' : 'No agents'}
          disabled={!!recipient || preparing || !agents.length}
          options={agents.map(agent => ({ value: agent.id, label: agent.name }))}
          onValueChange={id => {
            setAgentId(id);
            try { if (preferenceKey) window.localStorage.setItem(preferenceKey, id); } catch { /* Session selection remains available. */ }
          }} />
        <ChoiceMenu label="Reasoning effort" title="Reasoning effort" className="room-reasoning-trigger" icon={<Brain size={14} />} value={reasoning} onValueChange={setReasoning} disabled={!!recipient} options={reasoningLevels.map((value) => ({ value, label: value }))} />
        <InputGroupButton variant="default" size="icon-sm" className="ml-auto rounded-full" type="submit" disabled={preparing || !canSend || attachments.length > 0 || !draft.trim() || Boolean(mention) || (!recipient && (!selected || agentBusy))} aria-label={recipient ? 'Send direct message' : 'Send private instruction'}><ArrowUp size={17} /></InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
    {submitError && <p role="alert" className="room-local-note">{submitError}</p>}
    <p className="room-local-note">Enter to send or continue a list · Enter on an empty item to end the list · Shift + Enter for a new line · Start lists with - / * / 1. / 1) and a space</p>
    {attachments.length > 0 && <p id={attachmentNoteId} role="status" className="room-local-note">Files stay on this device. Remove attachments to send a text message.</p>}
    <p className="room-local-note">{recipient ? `Only you and ${recipient.name} can see this message.` : 'Messages go privately to your agent. Type @ to message a room member.'}</p>
    </form>
    </div>
  </>;
}
