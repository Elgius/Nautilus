import { tool } from 'ai'
import { z } from 'zod'
import type { Database } from '../db'
import type { AgentSkill } from '../agent_interface/skills'

/** Safe discovery for the legacy roomless chat. Mutations use durable Hub runs. */
export function createDiscoverySkill(withDatabase: <T>(action: (db: Database) => Promise<T>) => Promise<T>, organizationId: string, userId: string): AgentSkill {
  const scope = { organizationId, room: { organizationId, members: { some: { member: { organizationId, userId } } } } }
  return { id: 'hub-discovery', instructions: 'Find saved documents only in the requesting user’s joined rooms. For document reads, edits, task CRUD, calendar or scheduled work, ask the user to select the matching room in Agent Hub; those capabilities execute through its durable run routes. Do not claim roomless chat has saved changes.', tools: {
    lookupDocuments: tool({ description: 'Find saved documents by title across the current user’s joined rooms, 25 per page.', inputSchema: z.strictObject({ title: z.string().max(200).optional(), after: z.uuid().optional() }), execute: ({ title, after }) => withDatabase(async (db) => {
      const rows = await db.document.findMany({ where: { ...scope, ...(title ? { title: { contains: title, mode: 'insensitive' } } : {}), ...(after ? { id: { gt: after } } : {}) }, select: { id: true, title: true, kind: true, roomId: true, currentVersionId: true }, orderBy: { id: 'asc' }, take: 26 })
      return { documents: rows.slice(0, 25), nextCursor: rows.length > 25 ? rows[24].id : null }
    }) }),
  } }
}
