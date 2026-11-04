"use client";

import { LockKeyhole } from "lucide-react";
import { AgentPortrait } from "@/components/agents/agent-portrait";
import type { AgentAppearance } from "../../../../shared/agent-appearance";
import { Button } from "@/components/ui/button";
import type { PrivateAgentJob, RoomAgentOption } from "../../../../shared/room-chat";

export function PrivateAgentConversation({ jobs, agents = [], canSend, busy, retry }: {
  jobs: PrivateAgentJob[];
  agents?: (AgentAppearance & { id: string; name: string })[];
  canSend: boolean;
  busy: boolean;
  retry: (agent: RoomAgentOption, instruction: string) => boolean;
}) {
  if (!jobs.length) return null;
  return <section className="room-private-conversation" aria-label="Your private agent conversation">
    <h3><LockKeyhole size={14} /> Your agent · Only you</h3>
    {jobs.map((job) => <article className="room-private-turn" key={job.id} aria-label={`Private instruction to ${job.agentName}`}>
      <div className="room-private-turn-heading"><AgentPortrait agent={agents.find((agent) => agent.id === job.agentId) ?? { name: job.agentName }} small /><strong>{job.agentName}</strong><span>Private</span></div>
      <p className="room-private-instruction"><strong>You:</strong> {job.instruction}</p>
      {job.reply && <p className="room-private-reply">{job.reply}</p>}
      <p className="room-private-status" role="status">{job.status === 'queued' ? 'Waiting to send…' : job.status === 'running' ? 'Agent is replying…' : job.status === 'failed' ? job.error ?? 'The agent could not reply.' : 'Response complete'}</p>
      {job.status === 'failed' && <Button type="button" size="sm" variant="outline" disabled={!canSend || busy} onClick={() => retry({ id: job.agentId, name: job.agentName, role: '' }, job.instruction)}>Retry privately</Button>}
    </article>)}
  </section>;
}
