"use client";

import { AgentPortrait } from "@/components/agents/agent-portrait";
import { useRunAvatarState } from "@/components/agents/use-run-avatar-state";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { agentRunAppearance } from "@/lib/agent-run-appearance";
import type { AvatarState } from "open-bot-avatar";
import type { AgentAppearance } from "../../../../shared/agent-appearance";
import type { PrivateAgentJob } from "../../../../shared/room-chat";

type AvatarAgent = AgentAppearance & { name: string };

export function RoomAgentAvatar({ agent, state }: { agent: AvatarAgent; state?: AvatarState }) {
  return <Avatar className="room-agent-avatar" aria-hidden="true">
    {agent.avatarUrl && <AvatarImage src={agent.avatarUrl} alt="" />}
    <AvatarFallback><AgentPortrait agent={{ ...agent, avatarUrl: undefined }} state={state} small /></AvatarFallback>
  </Avatar>;
}

export function RoomRunAvatar({ agent, job }: { agent: AvatarAgent; job: PrivateAgentJob }) {
  const state = useRunAvatarState(agentRunAppearance(job).state, job.id);
  return <RoomAgentAvatar agent={agent} state={state} />;
}
