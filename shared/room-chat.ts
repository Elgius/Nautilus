import type { AgentAppearance } from './agent-appearance';

export type ChatUser = { id: string; name: string };
export type ChatServerEvent<Message> = PrivateAgentEvent
  | { type: 'ready' | 'pong' }
  | { type: 'message'; message: Message }
  | { type: 'ack'; requestId: string; message: Message }
  | { type: 'sync' | 'history'; messages: Message[]; nextCursor: string | null }
  | { type: 'presence'; users: ChatUser[] }
  | { type: 'typing'; userId: string; name: string; expiresAt: number }
  | { type: 'read'; userId: string; readAt: string }
  | { type: 'error'; requestId?: string; error: string };

export type RoomAgentOption = AgentAppearance & { id: string; name: string; role: string };
export type PrivateAgentJob = {
  id: string;
  agentId: string;
  agentName: string;
  instruction: string;
  reply: string;
  status: 'queued' | 'running' | 'complete' | 'failed';
  error?: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
};
export type PrivateAgentEvent =
  | { type: 'agent.list'; agents: RoomAgentOption[] }
  | { type: 'agent.history'; jobs: PrivateAgentJob[] }
  | { type: 'agent.update'; job: PrivateAgentJob };
