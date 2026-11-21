"use client";

import { buildHubCitations } from '../../../../shared/agent-citations';
import { RunDetails } from '@/components/agent-hub/run-details';
import { agentRunErrorMessage } from '../../../../shared/agent-errors';
import { AgentOperationWarnings } from './agent-operation-warnings';
import { ChevronDown, LockKeyhole } from "lucide-react";
import { memo, useId, useState } from "react";
import { RoomMessageText } from "./room-message-text";
import { RoomRunAvatar } from "./room-agent-avatar";
import { agentRunAppearance } from "@/lib/agent-run-appearance";
import type { AgentAppearance } from "../../../../shared/agent-appearance";
import { Button } from "@/components/ui/button";
import type { AgentRunMode, HubCitation, PrivateAgentJob, RoomAgentOption } from "../../../../shared/room-chat";

export const AgentReply = memo(function AgentReply({ text, job, citations: suppliedCitations }: { text: string; job?: PrivateAgentJob; citations?: HubCitation[] }) {
  const citations = suppliedCitations ?? job?.citations ?? buildHubCitations(text, job?.sources ?? []);
  return <RoomMessageText text={text} className="room-private-reply" citations={citations} />;
});

type ConversationProps = {
  full?: boolean;
  roomId?: string;
  confirm?: (jobId: string, confirmationId: string, approved: boolean) => void | Promise<void>;
  jobs: PrivateAgentJob[];
  agents?: (AgentAppearance & { id: string; name: string })[];
  canSend: boolean;
  busy: boolean;
  retry: (agent: RoomAgentOption, instruction: string, mode?: AgentRunMode) => boolean | Promise<boolean>;
  cancel?: (jobId: string) => void;
};

export function PrivateAgentConversation({ jobs, agents = [], canSend, busy, retry, cancel, roomId, confirm, full = false }: ConversationProps) {
  const [expanded, setExpanded] = useState(false);
  const historyId = useId();
  if (!jobs.length) return null;
  const latest = jobs[jobs.length - 1];
  const visibleJobs = full || expanded ? jobs : jobs.filter((job) => job.id === latest.id || (job.question && !job.question.answer));
  return <section className="room-private-conversation" aria-label="Your private agent conversation" data-expanded={expanded}>
    <button type="button" className="room-private-conversation-toggle" aria-expanded={expanded} aria-controls={historyId} onClick={() => setExpanded((value) => !value)}><LockKeyhole size={14} aria-hidden="true" /><span>Your agent · Only you</span><ChevronDown className="room-private-conversation-chevron" size={16} aria-hidden="true" /></button>
    <div id={historyId} className="room-private-conversation-content" hidden={!visibleJobs.length}>
    {visibleJobs.map((job) => <article className="room-private-turn" key={job.id} aria-label={`Private instruction to ${job.agentName}`}>
      <div className="room-private-turn-heading"><RoomRunAvatar agent={agents.find((agent) => agent.id === job.agentId) ?? { name: job.agentName }} job={job} /><strong>{job.agentName}</strong><span>Private</span></div>
      <div className="room-private-instruction"><strong>You:</strong><RoomMessageText text={job.instruction} /></div>
      {job.reply && <AgentReply text={job.reply} job={job} />}
      {job.question && <div className="room-private-question"><RoomMessageText text={job.question.question} />{job.question.answer && <p className="whitespace-pre-wrap"><strong>Your answer:</strong> {job.question.answer}</p>}</div>}
      <AgentRunFeedback {...{ job, roomId, confirm, cancel, canSend, busy, retry }} />
    </article>)}
    </div>
  </section>;
}

export function AgentRunFeedback({ job, roomId, confirm, cancel, canSend, busy, retry }: Omit<ConversationProps, "jobs"> & { job: PrivateAgentJob }) {
  const { label } = agentRunAppearance(job);
  let status = label;
  if (job.status === 'failed') status = job.errorCode ? agentRunErrorMessage(job.errorCode, job.commits?.length ?? 0) : job.error ?? 'The agent could not reply.';
  if (job.status === 'complete' && label === 'Completed' && job.issues?.length) status = 'Response complete with operation warnings';
  return <>
      {status && <p className="room-private-status" role="status">{status}</p>}
      {!!job.commits?.length && !(job.status === 'failed' && job.errorCode) && <p className="room-private-status">{job.commits.length} edit {job.commits.length === 1 ? 'batch' : 'batches'} saved.</p>}
      {(job.status === 'complete' || job.status === 'failed') && <AgentOperationWarnings issues={job.issues} />}
      <RunDetails job={job} roomId={roomId} confirm={confirm} />
      {cancel && (job.status === 'queued' || job.status === 'running') && <Button type="button" size="sm" variant="ghost" disabled={!canSend} onClick={() => cancel(job.id)}>Cancel</Button>}
      {job.status === 'failed' && <Button type="button" size="sm" variant="outline" disabled={!canSend || busy} onClick={() => retry({ id: job.agentId, name: job.agentName, role: '' }, job.instruction, job.mode ?? 'write')}>Retry privately</Button>}
  </>;
}
