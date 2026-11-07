"use client";

import { LockKeyhole } from "lucide-react";
import { memo } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AgentPortrait } from "@/components/agents/agent-portrait";
import type { AgentAppearance } from "../../../../shared/agent-appearance";
import { Button } from "@/components/ui/button";
import type { PrivateAgentJob, RoomAgentOption } from "../../../../shared/room-chat";

const AgentReply = memo(function AgentReply({ text }: { text: string }) {
  return <div className="room-private-reply">
    <Markdown remarkPlugins={[remarkGfm]} skipHtml components={{
      a: ({ href, title, children }) => href ? <a href={href} title={title} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>,
      // Replies can describe images without automatically fetching model-supplied URLs.
      img: ({ alt }) => <span>{alt}</span>,
      table: ({ children }) => <div className="room-private-table"><table>{children}</table></div>,
    }}>{text}</Markdown>
  </div>;
});

export function PrivateAgentConversation({ jobs, agents = [], canSend, busy, retry, cancel }: {
  jobs: PrivateAgentJob[];
  agents?: (AgentAppearance & { id: string; name: string })[];
  canSend: boolean;
  busy: boolean;
  retry: (agent: RoomAgentOption, instruction: string) => boolean;
  cancel?: (jobId: string) => void;
}) {
  if (!jobs.length) return null;
  return <section className="room-private-conversation" aria-label="Your private agent conversation">
    <h3><LockKeyhole size={14} /> Your agent · Only you</h3>
    {jobs.map((job) => <article className="room-private-turn" key={job.id} aria-label={`Private instruction to ${job.agentName}`}>
      <div className="room-private-turn-heading"><AgentPortrait agent={agents.find((agent) => agent.id === job.agentId) ?? { name: job.agentName }} small /><strong>{job.agentName}</strong><span>Private</span></div>
      <p className="room-private-instruction"><strong>You:</strong> {job.instruction}</p>
      {job.reply && <AgentReply text={job.reply} />}
      <p className="room-private-status" role="status">{job.status === 'queued' ? 'Queued for the room moderator…' : job.status === 'running' ? 'Moderator is working…' : job.status === 'failed' ? job.error ?? 'The agent could not reply.' : 'Response complete'}</p>
      {!!job.commits?.length && <p className="room-private-status">{job.commits.length} edit {job.commits.length === 1 ? 'batch' : 'batches'} saved.</p>}
      {cancel && (job.status === 'queued' || job.status === 'running') && <Button type="button" size="sm" variant="ghost" disabled={!canSend} onClick={() => cancel(job.id)}>Cancel</Button>}
      {job.status === 'failed' && <Button type="button" size="sm" variant="outline" disabled={!canSend || busy} onClick={() => retry({ id: job.agentId, name: job.agentName, role: '' }, job.instruction)}>Retry privately</Button>}
    </article>)}
  </section>;
}
