import type { AgentWorkActivity, PrivateAgentEvent, PrivateAgentJob, RoomAgentOption } from '../../../shared/room-chat'
import { parseSend, type ChatIdentity } from './room-chat-service'
import { avatarColors, type AvatarColor } from '../../../shared/agent-appearance'

export type PrivateAgentProfile = RoomAgentOption & { rules: string[] }
export type PrivateAgentMessage = { role: 'user' | 'assistant'; content: string }
export type AgentRunContext = {
  id: string; token: string
  activity: (activity: AgentWorkActivity | null, agentId: string) => Promise<void>
  committed: (commit: NonNullable<PrivateAgentJob['commits']>[number]) => Promise<void>
  checkpoint: (id: string, value: unknown) => Promise<void>
  preview?: (toolCallId: string, input: string | null) => Promise<void>
}
type Entry = { identity: ChatIdentity; id: string; token?: string; deadline?: number; cancelRequested?: boolean }
type Dependencies = {
  storage: DurableObjectStorage
  profile: (identity: ChatIdentity, agentId: string) => Promise<PrivateAgentProfile | null>
  canAccess: (identity: ChatIdentity) => Promise<boolean>
  acquire: (identity: ChatIdentity, token: string) => Promise<boolean>
  release: (identity: ChatIdentity, token: string) => Promise<void>
  stream: (profile: PrivateAgentProfile, messages: PrivateAgentMessage[], signal: AbortSignal, identity: ChatIdentity, run: AgentRunContext) => AsyncIterable<string>
  send: (identity: ChatIdentity, event: PrivateAgentEvent) => Promise<void>
  waitUntil: (task: Promise<void>) => void
  changed?: (identity: ChatIdentity) => Promise<void>
}
const QUEUE = 'room-work:queue'
const ACTIVITIES = 'room-work:activities'
const RUN_MS = 180_000

/** Durable room FIFO; only the moderator owns write tools. Private conversations
 * remain user-scoped. Queue entries survive eviction; active runs are never
 * blindly replayed because they may already have committed document changes.
 */
export class PrivateRoomAgents {
  private draining = false
  private active?: { key: string; controller: AbortController }
  constructor(private deps: Dependencies) {}
  private prefix(identity: ChatIdentity) { return `private-agent:${encodeURIComponent(identity.userId)}:` }
  private key(identity: ChatIdentity, id: string) { return `${this.prefix(identity)}job:${id}` }
  async activity() {
    const queue = await this.deps.storage.get<Entry[]>(QUEUE) ?? []
    const first = queue[0]
    return { queued: queue.filter((entry) => !entry.token).length,
      activities: first?.deadline && first.deadline > Date.now()
        ? await this.deps.storage.get<AgentWorkActivity[]>(ACTIVITIES) ?? [] : [] }
  }
  async history(identity: ChatIdentity) {
    const ids = await this.deps.storage.get<string[]>(`${this.prefix(identity)}index`) ?? []
    const queue = await this.deps.storage.get<Entry[]>(QUEUE) ?? []
    const jobs: PrivateAgentJob[] = []
    for (const id of ids) {
      const key = this.key(identity, id)
      const job = await this.deps.storage.get<PrivateAgentJob>(key)
      if (!job) continue
      // Migrate interrupted pre-queue jobs without replaying their writes.
      if ((job.status === 'running' || job.status === 'queued') && !queue.some((entry) => this.key(entry.identity, entry.id) === key)) {
        job.status = 'failed'; job.error = 'The agent was interrupted. Please retry.'; job.revision++
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
    const now = new Date().toISOString()
    const job = await this.deps.storage.transaction(async (tx) => {
      const existing = await tx.get<PrivateAgentJob>(key)
      if (existing) {
        if (existing.agentId !== profile.id || existing.instruction !== instruction) throw new Error('Invalid reuse of an instruction ID.')
        return existing
      }
      const queue = await tx.get<Entry[]>(QUEUE) ?? []
      if (queue.length >= 100 || queue.filter((entry) => entry.identity.userId === identity.userId).length >= 20) throw new Error('Too many queued requests. Wait for some work to finish.')
      const job: PrivateAgentJob = { id, agentId: profile.id, agentName: profile.name, instruction, reply: '', status: 'queued', createdAt: now, updatedAt: now, revision: 0, commits: [] }
      const indexKey = `${this.prefix(identity)}index`
      const ids = await tx.get<string[]>(indexKey) ?? []
      const retained: string[] = []
      for (const oldId of ids) {
        if (retained.length < Math.max(0, ids.length - 49) && !queue.some((entry) => this.key(entry.identity, entry.id) === this.key(identity, oldId))) {
          await tx.delete(this.key(identity, oldId))
          retained.push(oldId)
        }
      }
      await tx.put(indexKey, [...ids.filter((oldId) => !retained.includes(oldId)), id])
      await tx.put(key, job)
      await tx.put(QUEUE, [...queue, { identity, id }])
      // Persist a wakeup with acceptance, before relying on waitUntil.
      await tx.setAlarm(Date.now() + 1000)
      return job
    })
    await this.safeSend(identity, job)
    await this.changed(identity)
    this.wake()
  }
  wake() {
    if (this.draining) return
    this.draining = true
    this.deps.waitUntil(this.drain().catch(async () => {
      // Storage/DB outages leave the durable queue intact for the alarm.
      await this.deps.storage.setAlarm(Date.now() + 5000)
    }).finally(() => { this.draining = false }))
  }
  async cancel(identity: ChatIdentity, id: string) {
    const key = this.key(identity, id)
    if (this.active?.key === key) this.active.controller.abort()
    await this.deps.storage.transaction(async (tx) => {
      const queue = await tx.get<Entry[]>(QUEUE) ?? []
      const entry = queue.find((entry) => this.key(entry.identity, entry.id) === key)
      if (!entry) return
      if (entry.token) {
        entry.cancelRequested = true
        await tx.put(QUEUE, queue)
        return
      }
      const job = await tx.get<PrivateAgentJob>(key)
      if (job) { job.status = 'failed'; job.error = 'Cancelled before starting.'; job.revision++; await tx.put(key, job) }
      await tx.put(QUEUE, queue.filter((item) => item !== entry))
    })
    // The run may have started while cancellation was being persisted.
    if (this.active?.key === key) this.active.controller.abort()
    const job = await this.deps.storage.get<PrivateAgentJob>(key)
    if (job) await this.safeSend(identity, job)
  }
  private async safeSend(identity: ChatIdentity, job: PrivateAgentJob) {
    // A disconnected subscriber must not change execution/commit state.
    try { await this.deps.send(identity, { type: 'agent.update', job: { ...job } }) } catch { /* replay via history */ }
  }
  private async changed(identity: ChatIdentity) {
    try { await this.deps.changed?.(identity) } catch { /* polling recovers missed notifications */ }
  }
  private async drain() {
    for (;;) {
      const entry = (await this.deps.storage.get<Entry[]>(QUEUE) ?? [])[0]
      if (!entry) { await this.deps.storage.delete(ACTIVITIES); return }
      const key = this.key(entry.identity, entry.id)
      const job = await this.deps.storage.get<PrivateAgentJob>(key)
      if (!job) { await this.remove(entry); continue }
      if (job.status === 'complete' || job.status === 'failed') {
        if (entry.token) await this.deps.release(entry.identity, entry.token)
        await this.remove(entry); continue
      }
      if (entry.token) {
        if ((entry.deadline ?? 0) > Date.now()) {
          await this.deps.storage.setAlarm(entry.deadline! + 1000); return
        }
        job.status = 'failed'; job.error = 'The agent was interrupted. Saved changes are preserved; review them before retrying.'; job.revision++
        await this.deps.storage.put(key, job)
        await this.deps.release(entry.identity, entry.token)
        await this.safeSend(entry.identity, job)
        await this.remove(entry); continue
      }
      if (!await this.deps.canAccess(entry.identity)) {
        job.status = 'failed'; job.error = 'Room access expired.'; job.revision++
        await this.deps.storage.put(key, job); await this.remove(entry); continue
      }
      const profile = await this.deps.profile(entry.identity, job.agentId)
      if (!profile) {
        job.status = 'failed'; job.error = 'This agent is no longer assigned to the room.'; job.revision++
        await this.deps.storage.put(key, job); await this.safeSend(entry.identity, job); await this.remove(entry); continue
      }
      const token = crypto.randomUUID()
      if (!await this.deps.acquire(entry.identity, token)) { await this.deps.storage.setAlarm(Date.now() + 5000); return }
      // Lease extends beyond execution deadline. Recovery waits for its expiry
      // before releasing a potentially orphaned run.
      entry.token = token; entry.deadline = Date.now() + 240_000
      try {
        await this.deps.storage.transaction(async (tx) => {
          const queue = await tx.get<Entry[]>(QUEUE) ?? []
          if (!queue[0] || this.key(queue[0].identity, queue[0].id) !== key) throw new Error('Queue head changed')
          queue[0] = entry; await tx.put(QUEUE, queue); await tx.setAlarm(entry.deadline! + 1000)
        })
        await this.run(entry, profile, job)
      } finally { await this.deps.release(entry.identity, token) }
      await this.remove(entry)
    }
  }
  private async remove(entry: Entry) {
    await this.deps.storage.transaction(async (tx) => {
      const queue = await tx.get<Entry[]>(QUEUE) ?? []
      await tx.put(QUEUE, queue.filter((item) => this.key(item.identity, item.id) !== this.key(entry.identity, entry.id)))
      await tx.delete(ACTIVITIES)
      const checkpoints = await tx.list({ prefix: `room-work:checkpoint:${encodeURIComponent(this.key(entry.identity, entry.id))}:` })
      for (const key of checkpoints.keys()) await tx.delete(key)
    })
    await this.changed(entry.identity)
  }
  private async run(entry: Entry, profile: PrivateAgentProfile, job: PrivateAgentJob) {
    const key = this.key(entry.identity, entry.id)
    const controller = new AbortController()
    this.active = { key, controller }
    const save = async () => {
      job.updatedAt = new Date().toISOString(); job.revision++
      await this.deps.storage.put(key, job); await this.safeSend(entry.identity, job)
    }
    const activities = new Map<string, AgentWorkActivity>()
    const colors = new Map<string, AvatarColor>()
    try {
      const current = (await this.deps.storage.get<Entry[]>(QUEUE) ?? []).find((item) => this.key(item.identity, item.id) === key)
      if (current?.cancelRequested) controller.abort()
      controller.signal.throwIfAborted()
      job.status = 'running'; await save()
      const messages: PrivateAgentMessage[] = [{ role: 'user', content: job.instruction }]
      let budget = 32_000 - job.instruction.length
      for (const old of (await this.history(entry.identity)).filter((item) => item.agentId === profile.id && item.status === 'complete').slice(-10).reverse()) {
        if (old.instruction.length + old.reply.length > budget) break
        messages.unshift({ role: 'user', content: old.instruction }, { role: 'assistant', content: old.reply })
        budget -= old.instruction.length + old.reply.length
      }
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(RUN_MS)])
      const context: AgentRunContext = {
        id: job.id, token: entry.token!,
        activity: async (activity, agentId) => {
          signal.throwIfAborted()
          if (activity) {
            let color = colors.get(agentId)
            if (!color) {
              const used = new Set(colors.values())
              color = activity.color && !used.has(activity.color) ? activity.color : avatarColors.find((candidate) => !used.has(candidate)) ?? 'violet'
              colors.set(agentId, color)
            }
            activities.set(agentId, { ...activity, color })
          } else activities.delete(agentId)
          await this.deps.storage.put(ACTIVITIES, [...activities.values()])
          await this.changed(entry.identity)
        },
        committed: async (commit) => { job.commits = [...(job.commits ?? []), commit]; await save(); await this.changed(entry.identity) },
        preview: async (toolCallId, input) => {
          signal.throwIfAborted()
          // Ephemeral, owner-only drafts; never persist them as document versions.
          try { await this.deps.send(entry.identity, { type: 'agent.document-preview', runId: job.id, toolCallId, input }) } catch { /* final content is recovered via work/history */ }
        },
        checkpoint: async (id, value) => { signal.throwIfAborted(); await this.deps.storage.put(`room-work:checkpoint:${encodeURIComponent(key)}:${id}`, value) },
      }
      await context.activity({ runId: job.id, agentId: profile.id, agentName: profile.name, color: profile.color, phase: 'planning' }, profile.id)
      let lastSent = 0
      for await (const delta of this.deps.stream(profile, messages, signal, entry.identity, context)) {
        signal.throwIfAborted()
        const reply = job.reply + delta
        // DO values have a byte limit; Unicode prompts/replies can exceed it
        // well before reaching the character limit. Keep the last safe reply.
        if (reply.length > 32_000 || new TextEncoder().encode(JSON.stringify({ ...job, reply })).byteLength > 110_000) throw new Error('Response too long')
        job.reply = reply
        if (Date.now() - lastSent >= 200) {
          if (!await this.deps.canAccess(entry.identity)) throw new Error('Access expired')
          await save(); lastSent = Date.now()
        }
      }
      if (!job.reply.trim() || !await this.deps.canAccess(entry.identity)) throw new Error('No response or access expired')
      job.status = 'complete'; await save()
    } catch {
      job.status = 'failed'; job.error = controller.signal.aborted ? 'Cancelled. Any saved changes are preserved.' : 'The agent could not complete this response. Please retry.'
      await save()
    } finally { controller.abort(); this.active = undefined }
  }
}
