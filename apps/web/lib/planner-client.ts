'use client';
import useSWR from 'swr';
import { roomRequest } from './room-client';

export type TaskStatus = 'To do' | 'In progress' | 'In review' | 'Done';
export type PlannerTask = { id: string; roomId: string; title: string; description: string; status: TaskStatus; date: string; agentIds: string[]; revision: number };
export type PlannerRoom = { id: string; name: string; agents: { agent: { id: string; name: string } }[] };
export type TaskSchedule = { id: string; scheduledAt: string; state: string; event: { taskId: string | null; title: string; instruction: string }; deliveries: { id: string; agentId: string; state: string; executionState: string | null; result: string | null; executionError: string | null; lastError: string | null }[]; roomId: string };
async function pages<T>(organizationId: string, roomId: string, resource: string, field: string) {
  const all: T[] = [];
  let cursor: string | null = null;
  do {
    const page: Record<string, unknown> & { nextCursor: string | null } = await roomRequest(organizationId, `/${encodeURIComponent(roomId)}/${resource}${cursor ? `?after=${encodeURIComponent(cursor)}` : ''}`);
    all.push(...page[field] as T[]); cursor = page.nextCursor;
  } while (cursor);
  return all;
}
export function usePlanner(organizationId: string) {
  return useSWR(['planner', organizationId], async () => {
    const { rooms } = await roomRequest<{ rooms: PlannerRoom[] }>(organizationId, '/planner');
    const data = await Promise.all(rooms.map(async (room) => {
      const [tasks, schedules] = await Promise.all([
        pages<PlannerTask>(organizationId, room.id, 'tasks', 'tasks'),
        pages<TaskSchedule>(organizationId, room.id, 'schedules', 'schedules'),
      ]);
      return { tasks, schedules: schedules.map((schedule) => ({ ...schedule, roomId: room.id })) };
    }));
    return { rooms, tasks: data.flatMap((item) => item.tasks), schedules: data.flatMap((item) => item.schedules) };
  }, { refreshInterval: 3000, revalidateOnFocus: true });
}
