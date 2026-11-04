import type { PrivateAgentEvent, PrivateAgentJob, RoomAgentOption } from '../../../shared/room-chat'
import { parseSend, type ChatIdentity } from './room-chat-service'

export type PrivateAgentProfile = RoomAgentOption & { rules: string[] }
export type PrivateAgentMessage = { role: 'user' | 'assistant'; content: string }
type Dependencies = {
  storage: DurableObjectStorage
  profile: (identity: ChatIdentity, agentId: string) => Promise<PrivateAgentProfile | null>
  canAccess: (identity: ChatIdentity) => Promise<boolean>
  stream: (profile: PrivateAgentProfile, messages: PrivateAgentMessage[], signal: AbortSignal) => AsyncIterable<string>
  send: (identity: ChatIdentity, event: PrivateAgentEvent) => Promise<void>
  waitUntil: (task: Promise<void>) => void
}

// This store has no room-message writer or room broadcast dependency. A user's
// instructions and replies can leave it only through the private send callback.
export class PrivateRoomAgents {
  private active = new Set<string>()
  constructor(private deps: Dependencies) {}
  private prefix(identity: ChatIdentity) { return `private-agent:${encodeURIComponent(identity.userId)}:` }
  private key(identity: ChatIdentity, id: string) { return `${this.prefix(identity)}job:${id}` }

  async history(identity: ChatIdentity) {
    const ids = await this.deps.storage.get<string[]>(`${this.prefix(identity)}index`) ?? []
    const jobs: PrivateAgentJob[] = []
    for (const id of ids) {
      const key = this.key(identity, id)
      const job = await this.deps.storage.get<PrivateAgentJob>(key)
      if (!job) continue
      // A process restart must not silently charge the user for a second run.
      if ((job.status === 'queued' || job.status === 'running') && !this.active.has(key)) {
        job.status = 'failed'; job.error = 'The agent was interrupted. Please retry.'; job.updatedAt = new Date().toISOString(); job.revision++
        await this.deps.storage.put(key, job)
      }
      jobs.push(job)
    }
    return jobs
  }

  async invoke(identity: ChatIdentity, input: Record<string, unknown>) {
    const { clientMessageId: id, text: instruction } = parseSend({ clientMessageId: input.requestId, text: input.instruction })
    if (typeof input.agentId !== 'string' || !input.agentId || input.agentId.length > 100) throw new Error('Invalid agent selection.')
    const profile = await this.deps.profile(identity, input.agentId)
    if (!profile) throw new Error('Invalid agent selection. Choose an agent assigned to this room.')
    const key = this.key(identity, id)
    const existing = await this.deps.storage.get<PrivateAgentJob>(key)
    if (existing) {
      if ((existing.status === 'queued' || existing.status === 'running') && !this.active.has(key)) {
        existing.status = 'failed'; existing.error = 'The agent was interrupted. Please retry.'; existing.revision++; existing.updatedAt = new Date().toISOString()
        await this.deps.storage.put(key, existing)
      }
      if (existing.agentId !== profile.id || existing.instruction !== instruction) throw new Error('Invalid reuse of an instruction ID.')
      await this.deps.send(identity, { type: 'agent.update', job: existing })
      return
    }
    const previous = await this.history(identity)
    if (previous.some((job) => job.status === 'running' || job.status === 'queued')) throw new Error('Too many agent requests. Wait for your current response.')
    const now = new Date().toISOString()
    const job: PrivateAgentJob = { id, agentId: profile.id, agentName: profile.name, instruction, reply: '', status: 'queued', createdAt: now, updatedAt: now, revision: 0 }
    // The room coordinator serializes invoke handlers; background runs update
    // only their own job key, never this per-user index.
    const indexKey = `${this.prefix(identity)}index`
    await this.deps.storage.transaction(async (tx) => {
      const ids = await tx.get<string[]>(indexKey) ?? []
      for (const oldId of ids.slice(0, Math.max(0, ids.length - 49))) await tx.delete(this.key(identity, oldId))
      await tx.put(key, job)
      await tx.put(indexKey, [...ids.slice(-49), id])
    })
    this.active.add(key)
    // Register the background task before returning to the room queue. Human
    // messages and other users' agents can continue during model generation.
    this.deps.waitUntil(this.run(identity, profile, job, previous).finally(() => { this.active.delete(key) }))
    await this.deps.send(identity, { type: 'agent.update', job: { ...job } })
  }

  private async run(identity: ChatIdentity, profile: PrivateAgentProfile, job: PrivateAgentJob, previous: PrivateAgentJob[]) {
    const key = this.key(identity, job.id)
    const controller = new AbortController()
    const save = async () => {
      job.updatedAt = new Date().toISOString(); job.revision++
      await this.deps.storage.put(key, job)
      await this.deps.send(identity, { type: 'agent.update', job: { ...job } })
    }
    try {
      if (!await this.deps.canAccess(identity)) throw new Error('Access expired')
      job.status = 'running'; await save()
      const messages: PrivateAgentMessage[] = [{ role: 'user', content: job.instruction }]
      let budget = 32_000 - job.instruction.length
      // Only the invoking user's history with this agent enters its context.
      for (const old of previous.filter((item) => item.agentId === profile.id && item.status === 'complete').slice(-10).reverse()) {
        if (old.instruction.length + old.reply.length > budget) break
        messages.unshift({ role: 'user', content: old.instruction }, { role: 'assistant', content: old.reply })
        budget -= old.instruction.length + old.reply.length
      }
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(65_000)])
      let lastSent = 0
      for await (const delta of this.deps.stream(profile, messages, signal)) {
        signal.throwIfAborted()
        job.reply += delta
        if (job.reply.length > 32_000) throw new Error('Response too long')
        if (Date.now() - lastSent >= 200) {
          if (!await this.deps.canAccess(identity)) throw new Error('Access expired')
          await save(); lastSent = Date.now()
        }
      }
      if (!job.reply.trim() || !await this.deps.canAccess(identity)) throw new Error('No response or access expired')
      job.status = 'complete'
      await save()
    } catch {
      job.status = 'failed'; job.error = 'The agent could not complete this response. Please retry.'
      // Provider exceptions and prompts must never appear in logs or errors.
      await save()
    } finally { controller.abort() }
  }
}
