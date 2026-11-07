import type { AgentAppearance } from './agent-appearance';

export type ChatUser = { id: string; name: string };
export type AgentWorkActivity = {
  runId: string; agentId: string; agentName: string; color?: AgentAppearance['color'];
  documentId?: string; target?: string;
  phase: 'planning' | 'reading' | 'proposing' | 'applying';
};
export type RoomWorkState = {
  locked: boolean; queued: number; activities: AgentWorkActivity[];
  expiresAt: string | null;
  versions?: Record<string, string | null>;
};
export type ChatServerEvent<Message> = PrivateAgentEvent
  | { type: 'work.update'; work: RoomWorkState }
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
  commits?: { documentId: string; versionId: string; versionNumber: number }[];
};
export type PrivateAgentEvent =
  | { type: 'agent.document-preview'; runId: string; toolCallId: string; input: string | null }
  | { type: 'agent.list'; agents: RoomAgentOption[] }
  | { type: 'agent.history'; jobs: PrivateAgentJob[] }
  | { type: 'agent.update'; job: PrivateAgentJob };
