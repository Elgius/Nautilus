import { sourceForRead } from './read-sources'
import type { AgentSkill } from '../agent_interface/skills'
import type { AgentRunContext } from '../private-room-agents'
import type { Database } from '../db'
import { canChat, type ChatIdentity } from '../room-chat-service'
import { createKnowledgeSkill } from './knowledge'

/** Register shared Hub capabilities on every interactive room run. */
export function completeHubSkills(skills: AgentSkill[], run: AgentRunContext, identity: ChatIdentity,
  withDatabase: <T>(action: (db: Database) => Promise<T>) => Promise<T>, signal: AbortSignal): AgentSkill[] {
  const personal = run.options?.knowledge.includes('PERSONAL') ?? false
  const mutate = /^(apply|create|update|delete|accept|schedule|reschedule|cancel|save|delegate)/
  const registered = [...skills, createKnowledgeSkill((action) => withDatabase(async (db) => {
    if (!await canChat(db, identity) || (run.agentId && !await db.roomAgent.findFirst({ where: { organizationId: identity.organizationId, roomId: identity.roomId, agentId: run.agentId } }))) throw new Error('Room or agent access expired.')
    return action(db)
  }), identity, run.options?.knowledge ?? ['ORGANIZATION'], signal, run.sources)].map((skill) => ({
    ...skill,
    instructions: `${skill.instructions}${personal ? '\nPersonal knowledge is enabled: this run is private and read only. Shared writes, scheduling and delegation are disabled. Ask the user to disable Personal knowledge for a separate shared-action request.' : ''}`,
    tools: Object.fromEntries(Object.entries(skill.tools).map(([name, definition]) => {
      if (!definition.execute) return [name, definition]
      const execute = definition.execute
      return [name, { ...definition, execute: async (...args: Parameters<typeof execute>) => {
        signal.throwIfAborted()
        if (personal && mutate.test(name)) throw new Error('Disable Personal knowledge and start a separate request before changing shared work or delegating.')
        if (name === 'deleteTask' && run.confirm && !await run.confirm(`Delete task ${(args[0] as { taskId?: string }).taskId ?? ''}? This removes it from Kanban and Calendar and cancels pending execution.`)) throw new Error('Task deletion was declined or the confirmation expired.')
        return execute(...args)
      } }]
    })),
  }))
  return withHubReadSources(registered, identity, run.sources)
}


/** Decorate only the supplied scoped tools; specialists gain no additional access. */
export function withHubReadSources(skills: AgentSkill[], identity: ChatIdentity, record?: AgentRunContext['sources']): AgentSkill[] {
  const documentTitles = new Map<string, string>()
  return skills.map((skill) => ({ ...skill,
    instructions: `${skill.instructions}\nCite facts obtained from resource reads using the returned citationSources markers, such as [source title](#source-SOURCE_ID). Cite every source-based factual claim near that claim. Never invent source IDs or treat a listing as a content read.`,
    tools: Object.fromEntries(Object.entries(skill.tools).map(([name, definition]) => {
      if (!definition.execute) return [name, definition]
      const execute = definition.execute
      return [name, { ...definition, execute: async (...args: Parameters<typeof execute>) => {
        const result = await execute(...args)
        const sources = sourceForRead(name, args[0], result, identity, documentTitles)
        if (!sources.length) return result
        await record?.(sources)
        return { ...(result as Record<string, unknown>), citationSources: sources.map((source) => ({ id: source.id, title: source.title, marker: `[${source.title}](#source-${source.id})` })) }
      } }]
    })),
  }))
}
