import type { AgentWorkActivity } from './room-chat';

export type ActivityStatus = 'queued' | 'running' | 'complete' | 'failed' | 'cancelled';
export type ActivityRun = {
  id: string; roomId: string; roomName: string; agentId: string; agentName: string;
  title: string; status: ActivityStatus; source: 'manual' | 'scheduled';
  createdAt: string; updatedAt: string; startedAt: string | null; finishedAt: string | null;
  activities: AgentWorkActivity[]; documentCount: number; taskCount: number;
};
export type ActivityPage = {
  runs: ActivityRun[]; active: ActivityRun[]; nextCursor: string | null;
  rooms: { id: string; name: string }[]; agents: { id: string; name: string }[];
};
export type ActivityDetail = {
  instruction: string; reply: string; error: string | null;
  documents: { documentId: string; versionId: string; versionNumber: number; title: string; available: boolean }[];
  tasks: { taskId: string; revision: number; title: string; available: boolean }[];
};
