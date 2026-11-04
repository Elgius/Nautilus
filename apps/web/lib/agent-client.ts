import type { Agent, AgentProfile, AgentCreationInput } from "./agent-data";
import { parseAvatarDesign } from '../../../shared/avatar-design';

export type StoredAgent = Omit<Agent, "initials" | "avatarUrl" | "avatarDesign"> & {
  avatarUrl: string | null;
  avatarDesign?: unknown;
};

export function toAgent(agent: StoredAgent): Agent {
  let avatarDesign: Agent['avatarDesign'];
  if (agent.avatarDesign != null) {
    try { avatarDesign = parseAvatarDesign(agent.avatarDesign); } catch { /* Use the preset for invalid stored designs. */ }
  }
  return { ...agent, avatarUrl: agent.avatarUrl ?? undefined, avatarDesign, initials: agent.name.slice(0, 2) };
}

export async function persistAgent(organizationId: string, profile: AgentProfile, id?: string): Promise<Agent> {
  const response = await fetch(
    `/api/organizations/${encodeURIComponent(organizationId)}/agents${id ? `/${encodeURIComponent(id)}` : ""}`,
    {
      method: id ? "PATCH" : "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...profile, avatarUrl: profile.avatarUrl ?? null, avatarDesign: profile.avatarDesign ?? null }),
    },
  );
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.agent) throw new Error(result?.error || "Couldn’t save this agent. Please try again.");
  return toAgent(result.agent);
}

export async function createAgentFromDescription(organizationId: string, input: AgentCreationInput): Promise<Agent> {
  const response = await fetch(
    `/api/organizations/${encodeURIComponent(organizationId)}/agent_creator_agent`,
    {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.agent) throw new Error(result?.error || "Couldn’t create this agent. Please try again.");
  return toAgent(result.agent);
}
