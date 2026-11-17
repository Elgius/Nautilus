"use client";

import { ChevronDown, LockKeyhole } from "lucide-react";
import { memo, useId, useState } from "react";
import { RoomMessageText } from "./room-message-text";
import { RoomAgentAvatar } from "./room-agent-avatar";
import type { AgentAppearance } from "../../../../shared/agent-appearance";
import { Button } from "@/components/ui/button";
import type { AgentRunMode, PrivateAgentJob, RoomAgentOption } from "../../../../shared/room-chat";
import { agentRunErrorMessage } from "../../../../shared/agent-errors";
import { AgentOperationWarnings } from './agent-operation-warnings';

export const AgentReply = memo(function AgentReply({ text }: { text: string }) {
  return <RoomMessageText text={text} className="room-private-reply" />;
});

export function PrivateAgentConversation({ jobs, agents = [], canSend, busy, retry, cancel }: {
  jobs: PrivateAgentJob[];
  agents?: (AgentAppearance & { id: string; name: string })[];
  canSend: boolean;
  busy: boolean;
  retry: (agent: RoomAgentOption, instruction: string, mode?: AgentRunMode) => boolean | Promise<boolean>;
  cancel?: (jobId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const historyId = useId();
  if (!jobs.length) return null;
  const latest = jobs[jobs.length - 1];
  const visibleJobs = expanded ? jobs : [latest];
  return <section className="room-private-conversation" aria-label="Your private agent conversation" data-expanded={expanded}>
    <button type="button" className="room-private-conversation-toggle" aria-expanded={expanded} aria-controls={historyId} onClick={() => setExpanded((value) => !value)}><LockKeyhole size={14} aria-hidden="true" /><span>Your agent · Only you</span><ChevronDown className="room-private-conversation-chevron" size={16} aria-hidden="true" /></button>
    <div id={historyId} className="room-private-conversation-content" hidden={!visibleJobs.length}>
    {visibleJobs.map((job) => <article className="room-private-turn" key={job.id} aria-label={`Private instruction to ${job.agentName}`}>
      <div className="room-private-turn-heading"><RoomAgentAvatar agent={agents.find((agent) => agent.id === job.agentId) ?? { name: job.agentName }} /><strong>{job.agentName}</strong><span>Private</span></div>
      <div className="room-private-instruction"><strong>You:</strong><RoomMessageText text={job.instruction} /></div>
      {job.reply && <AgentReply text={job.reply} />}
      <p className="room-private-status" role="status">{job.status === 'queued' ? job.mode === 'read' ? 'Waiting for an Ask slot…' : 'Queued for the room moderator…' : job.status === 'running' ? job.mode === 'read' ? 'Reading and answering…' : 'Moderator is working…' : job.status === 'failed' ? job.errorCode ? agentRunErrorMessage(job.errorCode, job.commits?.length ?? 0) : job.error ?? 'The agent could not reply.' : job.issues?.length ? 'Response complete with operation warnings' : 'Response complete'}</p>
      {!!job.commits?.length && !(job.status === 'failed' && job.errorCode) && <p className="room-private-status">{job.commits.length} edit {job.commits.length === 1 ? 'batch' : 'batches'} saved.</p>}
      {(job.status === 'complete' || job.status === 'failed') && <AgentOperationWarnings issues={job.issues} />}
      {cancel && (job.status === 'queued' || job.status === 'running') && <Button type="button" size="sm" variant="ghost" disabled={!canSend} onClick={() => cancel(job.id)}>Cancel</Button>}
      {job.status === 'failed' && <Button type="button" size="sm" variant="outline" disabled={!canSend || busy} onClick={() => retry({ id: job.agentId, name: job.agentName, role: '' }, job.instruction, job.mode ?? 'write')}>Retry privately</Button>}
    </article>)}
    </div>
  </section>;
}
