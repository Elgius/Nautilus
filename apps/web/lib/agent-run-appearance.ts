import type { AvatarState } from 'open-bot-avatar';
import type { AgentWorkActivity, PrivateAgentJob } from '../../../shared/room-chat';

const phaseAppearance = {
  planning: { state: 'thinking', label: 'Planning' },
  reading: { state: 'working', label: 'Reading' },
  proposing: { state: 'working', label: 'Drafting changes' },
  applying: { state: 'working', label: 'Applying changes' },
} satisfies Record<AgentWorkActivity['phase'], { state: AvatarState; label: string }>;

export function roomActivityAppearance(activities: AgentWorkActivity[], agentId: string) {
  const current = activities.filter((activity) => activity.agentId === agentId);
  const activity = current.find((activity) => activity.phase !== 'planning') ?? current[0];
  return activity ? phaseAppearance[activity.phase] : undefined;
}

export function agentRunAppearance(job: PrivateAgentJob): { state: AvatarState; label: string } {
  if (job.status === 'failed') {
    return job.errorCode === 'RUN_CANCELLED'
      ? { state: 'idle', label: 'Cancelled' }
      : { state: 'blocked', label: 'Blocked' };
  }
  if (job.question && job.question.answer === undefined) return { state: 'waiting', label: 'Waiting for your answer' };
  if (job.status === 'complete') {
    return job.question ? { state: 'idle', label: '' } : { state: 'done', label: 'Completed' };
  }
  if (job.status === 'queued') return { state: 'waiting', label: 'Queued' };
  if (job.confirmations?.some((confirmation) => confirmation.status === 'pending')) {
    return { state: 'waiting', label: 'Awaiting approval' };
  }
  const activity = roomActivityAppearance(job.activities ?? [], job.agentId);
  if (activity?.state === 'working') return activity;
  if (job.tools?.some((tool) => tool.status === 'running')) return { state: 'working', label: 'Using tools' };
  if (job.reply) return { state: 'working', label: 'Writing reply' };
  return { state: 'thinking', label: 'Thinking' };
}
