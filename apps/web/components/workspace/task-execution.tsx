'use client';
import { useState } from 'react';
import useSWR from 'swr';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { roomRequest } from '@/lib/room-client';
import type { PlannerRoom, PlannerTask, TaskSchedule } from '@/lib/planner-client';
import { useRoomWork } from '@/components/room/use-room-work';

export function TaskExecution({ organizationId, task, room, schedules, onChange }: {
  organizationId: string; task: PlannerTask; room?: PlannerRoom; schedules: TaskSchedule[]; onChange: () => void;
}) {
  const [instruction, setInstruction] = useState('');
  const [time, setTime] = useState('');
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const work = useRoomWork(organizationId, task.roomId);
  const detail = useSWR(['task-history', organizationId, task.id, task.revision], () => roomRequest<{ task: PlannerTask & { changes: { id: string; revision: number; summary: string; agentId: string | null; createdAt: string }[] } }>(organizationId, `/${task.roomId}/tasks/${task.id}`));
  async function act(action: () => Promise<unknown>) {
    setBusy(true); setError('');
    try { await action(); onChange(); }
    catch (error) { setError(error instanceof Error ? error.message : 'Could not update execution.'); }
    finally { setBusy(false); }
  }
  return <section className="space-y-3 border-t pt-4" aria-label="Task execution">
    {work.locked && <p className="text-sm text-muted-foreground">Agents are working in this room. Task edits will be available when they finish.</p>}
    {work.activities.filter((activity) => activity.taskId === task.id).map((activity) => <p key={activity.agentId} role="status" className="text-sm">{activity.agentName}: {activity.phase}</p>)}
    <h3 className="text-sm font-semibold">Schedule agent work · Only you</h3>
    <p className="text-xs text-muted-foreground">Save task and assignment changes first. A due date does not start an agent. One-time runs are checked every minute and may start later.</p>
    <label className="block text-sm">Instruction<Textarea aria-label="Scheduled instruction" maxLength={12000} value={instruction} onChange={(event) => { setInstruction(event.target.value); setRequestId(crypto.randomUUID()); }} /></label>
    <label className="block text-sm">Execution time<Input aria-label="Execution time" type="datetime-local" value={time} onChange={(event) => { setTime(event.target.value); setRequestId(crypto.randomUUID()); }} /></label>
    <p className="text-xs text-muted-foreground">Timezone: {Intl.DateTimeFormat().resolvedOptions().timeZone}. Recipients: {task.agentIds.map((id) => room?.agents.find(({ agent }) => agent.id === id)?.agent.name || id).join(', ') || 'Assign an agent first'}.</p>
    <Button type="button" disabled={busy || task.status === 'Done' || !instruction.trim() || !time || !task.agentIds.length} onClick={() => void act(async () => {
      await roomRequest(organizationId, `/${task.roomId}/schedules`, 'POST', { requestId, taskId: task.id, title: task.title, instruction, scheduledAt: new Date(time).toISOString(), agentIds: task.agentIds });
      setInstruction(''); setTime(''); setRequestId(crypto.randomUUID());
    })}>Schedule assigned agents</Button>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {schedules.map((schedule) => <div key={schedule.id} className="space-y-2 rounded-lg border p-3 text-sm">
      <p><time dateTime={schedule.scheduledAt}>{new Date(schedule.scheduledAt).toLocaleString()}</time> · {schedule.state}</p>
      <p className="whitespace-pre-wrap break-words">{schedule.event.instruction}</p>
      {schedule.state === 'pending' && <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" disabled={busy || !time} onClick={() => void act(() => roomRequest(organizationId, `/${task.roomId}/schedules/${schedule.id}`, 'PATCH', { scheduledAt: new Date(time).toISOString() }))}>Reschedule to selected time</Button>
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void act(() => roomRequest(organizationId, `/${task.roomId}/schedules/${schedule.id}`, 'DELETE'))}>Cancel schedule</Button>
      </div>}
      {schedule.deliveries.map((delivery) => <div key={delivery.id} className="border-t pt-2">
        <p>{room?.agents.find(({ agent }) => agent.id === delivery.agentId)?.agent.name || 'Agent'} · {delivery.executionState || (delivery.state === 'accepted' ? 'Queued' : delivery.state)}</p>
        {(delivery.executionState === 'queued' || delivery.executionState === 'running' || (delivery.state === 'accepted' && !delivery.executionState)) && <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void act(() => roomRequest(organizationId, `/${task.roomId}/schedules/${schedule.id}/deliveries/${delivery.id}/cancel`, 'POST', {}))}>Cancel agent work</Button>}
        {delivery.result && <p className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words">{delivery.result}</p>}
        {(delivery.executionError || delivery.lastError) && <p className="text-destructive">{delivery.executionError || delivery.lastError}</p>}
      </div>)}
    </div>)}
    <h3 className="text-sm font-semibold">Recent task changes</h3>
    {detail.error && <p className="text-sm text-destructive">Could not load task history.</p>}
    {detail.data?.task.changes.map((change) => <p key={change.id} className="text-xs text-muted-foreground">Revision {change.revision} · {change.summary} · {change.agentId ? room?.agents.find(({ agent }) => agent.id === change.agentId)?.agent.name || 'Agent' : 'Room member'} · {new Date(change.createdAt).toLocaleString()}</p>)}
  </section>;
}
