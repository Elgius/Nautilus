"use client";

import { AgentPortrait } from "@/components/agents/agent-portrait";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { AgentAppearance } from "../../../../shared/agent-appearance";

export function RoomAgentAvatar({ agent }: { agent: AgentAppearance & { name: string } }) {
  return <Avatar className="room-agent-avatar" aria-hidden="true">
    {agent.avatarUrl && <AvatarImage src={agent.avatarUrl} alt="" />}
    <AvatarFallback><AgentPortrait agent={{ ...agent, avatarUrl: undefined }} small /></AvatarFallback>
  </Avatar>;
}
