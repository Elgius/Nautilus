"use client";

import { useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ArrowUp, Brain, FileText, LockKeyhole, Plus, X } from "lucide-react";
import { AgentPortrait } from "@/components/agents/agent-portrait";
import { Button } from "@/components/ui/button";
import { Attachment, AttachmentAction, AttachmentContent, AttachmentDescription, AttachmentMedia, AttachmentTitle } from "@/components/ui/attachment";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { agentMention, selectAgentMention } from "@/lib/agent-mention";
import { defaultRoomSuggestions } from "./use-room-suggestions";
import type { RoomAgentOption } from "../../../../shared/room-chat";

type Props = {
  suggestions?: string[];
  canSend: boolean;
  agents: RoomAgentOption[];
  agentsLoading: boolean;
  agentBusy: boolean;
  loadAgents: () => void;
  sendMessage: (text: string) => boolean;
  invokeAgent: (agent: RoomAgentOption, instruction: string) => boolean;
  sendTyping: () => void;
};
const reasoningLevels = ["Low", "Medium", "High"];

export function RoomChatComposer({ suggestions = defaultRoomSuggestions, canSend, agents, agentsLoading, agentBusy, loadAgents, sendMessage, invokeAgent, sendTyping }: Props) {
  const [draft, setDraft] = useState("");
  const [selected, setSelected] = useState<RoomAgentOption | null>(null);
  const [instruction, setInstruction] = useState("");
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [reasoning, setReasoning] = useState("Medium");
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  // Original Files stay in memory, separate from room documents and message payloads.
  const [attachments, setAttachments] = useState<{ id: string; file: File }[]>([]);
  const listId = useId();
  const attachmentNoteId = useId();
  const mention = selected ? null : agentMention(draft);
  const matches = agents.filter((agent) => agent.name.toLocaleLowerCase().startsWith(mention?.query.toLocaleLowerCase() ?? ""));
  const pickerOpen = Boolean(mention && !dismissed);
  const activeIndex = Math.min(active, Math.max(0, matches.length - 1));
  function select(agent: RoomAgentOption) {
    const result = selectAgentMention(draft, agent.name);
    setDraft(result.roomDraft); setInstruction(result.instruction); setSelected(agent); setDismissed(false);
    textarea.current?.focus();
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSend || attachments.length) return;
    if (selected) {
      if (!agentBusy && invokeAgent(selected, instruction)) setInstruction("");
    } else if (mention) {
      // An unresolved mention must never fall through to a public room message.
      setDismissed(false); loadAgents();
    } else if (draft.trim() && sendMessage(draft)) setDraft("");
  }
  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing) return;
    if (pickerOpen && ["ArrowDown", "ArrowUp", "Escape", "Enter", "Tab"].includes(event.key)) {
      if (event.key === 'Escape') { event.preventDefault(); setDismissed(true); return; }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault(); setActive((activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + Math.max(1, matches.length)) % Math.max(1, matches.length)); return;
      }
      if (matches.length && !agentsLoading && !event.shiftKey) { event.preventDefault(); select(matches[activeIndex]); return; }
      if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); return; }
    }
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); }
  }
  return <form onSubmit={submit} className="room-prompt-form">
    <div role="group" aria-label="Suggested prompts" className="room-chat-suggestions scroll-fade-x">
      {suggestions.map((suggestion) => <Button key={suggestion} type="button" variant="outline" size="sm" className="shrink-0" onClick={() => {
        // UI preview only: suggestions edit the current draft without sending or typing events.
        if (selected) setInstruction(suggestion); else setDraft(suggestion);
        setDismissed(false); textarea.current?.focus();
      }}>{suggestion}</Button>)}
    </div>
    <input ref={fileInput} type="file" multiple hidden aria-label="Choose local attachments" onChange={(event) => {
      const files = Array.from(event.currentTarget.files ?? []).map((file) => ({ id: crypto.randomUUID(), file }));
      setAttachments((previous) => [...previous, ...files]);
      event.currentTarget.value = "";
      textarea.current?.focus();
    }} />
    {pickerOpen && <div id={listId} role="listbox" aria-label="Choose an agent" className="room-agent-options">
      {agentsLoading ? <p role="status">Loading room agents…</p> : matches.length ? matches.map((agent, index) =>
        <button key={agent.id} id={`${listId}-${index}`} type="button" role="option" aria-selected={index === activeIndex} onMouseDown={(event) => event.preventDefault()} onClick={() => select(agent)}>
          <AgentPortrait agent={agent} small /><span><strong>{agent.name}</strong><small>{agent.role}</small></span><LockKeyhole size={13} />
        </button>) : <p role="status">{agents.length ? 'No matching agents. Edit the name after @.' : 'No agents are assigned to this room.'}</p>}
      <p className="room-local-note">Instructions and replies are visible only to you.</p>
    </div>}
    <InputGroup className="room-composer">
      {attachments.length > 0 && <InputGroupAddon align="block-start" className="room-prompt-attachments" aria-label="Local attachments">
        {attachments.map(({ id, file }) => <Attachment key={id}>
          <AttachmentMedia><FileText size={16} /></AttachmentMedia>
          <AttachmentContent><AttachmentTitle title={file.name}>{file.name}</AttachmentTitle><AttachmentDescription>Local only · {file.size < 1024 ? `${file.size} B` : file.size < 1024 * 1024 ? `${Math.ceil(file.size / 1024)} KB` : `${(file.size / (1024 * 1024)).toFixed(1)} MB`}</AttachmentDescription></AttachmentContent>
          <AttachmentAction aria-label={`Remove ${file.name}`} onClick={() => setAttachments((previous) => previous.filter((attachment) => attachment.id !== id))}><X size={13} /></AttachmentAction>
        </Attachment>)}
      </InputGroupAddon>}
      {selected && <InputGroupAddon align="block-start" className="room-private-target"><AgentPortrait agent={selected} small /><strong>@{selected.name}</strong><span><LockKeyhole size={12} /> Only you</span><Button type="button" size="icon-sm" variant="ghost" aria-label="Return to room chat" onClick={() => {
        // Never move private instruction text into the public room draft.
        setSelected(null); textarea.current?.focus();
      }}><X size={14} /></Button></InputGroupAddon>}
      <InputGroupTextarea ref={textarea} aria-label={selected ? `Private instruction to ${selected.name}` : "Message to room"} placeholder={selected ? `Instruct ${selected.name} privately…` : 'Message the room, or type @ for your agent…'}
        aria-describedby={attachments.length ? attachmentNoteId : undefined}
        role="combobox" aria-autocomplete="list" aria-expanded={pickerOpen} aria-controls={pickerOpen ? listId : undefined} aria-activedescendant={pickerOpen && matches.length ? `${listId}-${activeIndex}` : undefined}
        value={selected ? instruction : draft} onChange={(event) => {
          if (selected) { setInstruction(event.target.value); return; }
          const next = event.target.value;
          setDraft(next); setActive(0); setDismissed(false);
          if (agentMention(next)) { if (!mention) loadAgents(); }
          else sendTyping();
        }} rows={3} maxLength={20000} onKeyDown={keyDown} />
      <InputGroupAddon align="block-end" className="room-composer-footer">
        <InputGroupButton variant="outline" size="icon-sm" className="rounded-full" aria-label="Attach files" title="Attach files · local preview only" onClick={() => fileInput.current?.click()}><Plus size={17} /></InputGroupButton>
        <Select value={reasoning} onValueChange={(value) => { if (value) setReasoning(value); }}>
          <SelectTrigger aria-label="Reasoning effort" title="Reasoning effort · UI preview only" className="room-reasoning-trigger"><Brain size={14} /><SelectValue /></SelectTrigger>
          <SelectContent aria-label="Reasoning effort">
            {reasoningLevels.map((level) => <SelectItem key={level} value={level}>{level}</SelectItem>)}
          </SelectContent>
        </Select>
        <InputGroupButton variant="default" size="icon-sm" className="ml-auto rounded-full" type="submit" disabled={!canSend || attachments.length > 0 || (selected ? agentBusy || !instruction.trim() : !draft.trim() || Boolean(mention))} aria-label={selected ? 'Send private instruction' : 'Send message'}><ArrowUp size={17} /></InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
    <p className="room-local-note">Enter to send · Shift + Enter for a new line · Reasoning is a UI preview</p>
    {attachments.length > 0 && <p id={attachmentNoteId} role="status" className="room-local-note">Files stay on this device. Remove attachments to send a text message.</p>}
    <p className="room-local-note">{selected ? 'Only you can see this instruction and the agent’s reply.' : 'Room messages are shared with members. Use @ for private agent instructions.'}</p>
  </form>;
}
