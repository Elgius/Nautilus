import type { Agent, AgentProfile, AgentCreationInput } from "./agent-data";

export type StoredAgent = Omit<Agent, "initials" | "avatarUrl"> & {
  avatarUrl: string | null;
};

export function toAgent(agent: StoredAgent): Agent {
  return { ...agent, avatarUrl: agent.avatarUrl ?? undefined, initials: agent.name.slice(0, 2) };
}

export async function persistAgent(organizationId: string, profile: AgentProfile, id?: string): Promise<Agent> {
  const response = await fetch(
    `/api/organizations/${encodeURIComponent(organizationId)}/agents${id ? `/${encodeURIComponent(id)}` : ""}`,
    {
      method: id ? "PATCH" : "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...profile, avatarUrl: profile.avatarUrl ?? null }),
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
