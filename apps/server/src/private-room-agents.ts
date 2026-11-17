import type { AgentRunMode, AgentWorkActivity, PrivateAgentEvent, PrivateAgentJob, RoomAgentOption } from '../../../shared/room-chat'
import { parseSend, type ChatIdentity } from './room-chat-service'
import { logPipeline, type PipelineStage } from './agent-pipeline'
import { scheduleEarlierAlarm, scheduleRoomAlarm } from './room-alarm'
import { avatarColors, type AvatarColor } from '../../../shared/agent-appearance'
import { agentRunErrorMessage, type AgentOperationIssue } from '../../../shared/agent-errors'
import { AgentRunError, SkillOperationError, errorDiagnostics } from './skill-operation-error'

export type PrivateAgentProfile = RoomAgentOption & { rules: string[] }
export type PrivateAgentMessage = { role: 'user' | 'assistant'; content: string }
export type AgentRunContext = {
  id: string; token: string
  mode?: AgentRunMode
  stage?: (stage: PipelineStage) => void
  activity: (activity: AgentWorkActivity | null, agentId: string) => Promise<void>
  committed: (commit: NonNullable<PrivateAgentJob['commits']>[number]) => Promise<void>
  taskCommitted?: (commit: { taskId: string; revision: number }) => Promise<void>
  checkpoint: (id: string, value: unknown) => Promise<void>
  preview?: (toolCallId: string, input: string | null) => Promise<void>
  issue?: (issue: AgentOperationIssue) => void
}
type Entry = { identity: ChatIdentity; id: string; mode?: AgentRunMode; token?: string; deadline?: number; cancelRequested?: boolean }
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
  archive?: (identity: ChatIdentity, job: PrivateAgentJob) => Promise<void>
}
const QUEUE = 'room-work:queue'
const ACTIVITIES = 'room-work:activities:'
const OUTBOX = 'activity-archive:'
type ArchiveEntry = { identity: ChatIdentity; job: PrivateAgentJob }
const RUN_MS = 180_000

/** Durable room FIFO; only the moderator owns write tools. Private conversations
 * remain user-scoped. Queue entries survive eviction; active runs are never
 * blindly replayed because they may already have committed document changes.
 */
export class PrivateRoomAgents {
  private draining = false
  private pumpingReads = false
  private readsRequested = false
  private writesRequested = false
  private notification?: Promise<void>
  private notificationRequested = false
  private deliveries = new Map<string, Promise<void>>()
  private active = new Map<string, AbortController>()
  private archiving = false
  private lastArchived = new Map<string, { at: number; signature: string }>()
  constructor(private deps: Dependencies) {}
  private prefix(identity: ChatIdentity) { return `private-agent:${encodeURIComponent(identity.userId)}:` }
  private key(identity: ChatIdentity, id: string) { return `${this.prefix(identity)}job:${id}` }
  // Write the archive outbox in the same transaction as the job. A database
  // outage must neither lose history nor turn successful agent work into failure.
  private async putJob(tx: Pick<DurableObjectStorage, 'put'>, identity: ChatIdentity, job: PrivateAgentJob) {
    await tx.put(this.key(identity, job.id), job)
    if (this.deps.archive) await tx.put(`${OUTBOX}${this.key(identity, job.id)}`, { identity, job })
  }
  private async storeJob(identity: ChatIdentity, job: PrivateAgentJob) {
    await this.deps.storage.transaction((tx) => this.putJob(tx, identity, job))
  }
  private async flushArchive() {
    if (!this.deps.archive) return true
    const entries = await this.deps.storage.list<ArchiveEntry>({ prefix: OUTBOX, limit: 50 })
    let success = true
    for (const [key, entry] of entries) {
      if (!entry) continue
      try {
        await this.deps.archive(entry.identity, entry.job)
        await this.deps.storage.transaction(async (tx) => {
          const current = await tx.get<ArchiveEntry>(key)
          if (current?.job.revision === entry.job.revision) await tx.delete(key)
        })
      } catch { success = false }
    }
    return success
  }
  async archiveHistory(identity: ChatIdentity) {
    const jobs = await this.history(identity)
    await this.deps.storage.transaction(async (tx) => {
      for (const job of jobs) {
        const key = `${OUTBOX}${this.key(identity, job.id)}`
        const pending = await tx.get<ArchiveEntry>(key)
        // Import must never overwrite a job or an outbox snapshot that advanced
        // while history was being read.
        if (this.deps.archive && (!pending || pending.job.revision <= job.revision)) await tx.put(key, { identity, job })
      }
    })
    const success = await this.flushArchive()
    // Concurrent imports can enqueue more than one batch, or both flush the
    // same batch. Successful writes still need an alarm for anything left over.
    const pending = (await this.deps.storage.list({ prefix: OUTBOX, limit: 1 })).size > 0
    if (!success || pending) await scheduleRoomAlarm(this.deps.storage, Date.now() + 30_000)
    return success
  }
  async activity() {
    const queue = await this.deps.storage.get<Entry[]>(QUEUE) ?? []
    const activities = await Promise.all(queue.filter((entry) => entry.deadline && entry.deadline > Date.now())
      .map((entry) => this.deps.storage.get<AgentWorkActivity[]>(ACTIVITIES + this.key(entry.identity, entry.id))))
    return { queued: queue.filter((entry) => !entry.token).length, activities: activities.flatMap((items) => items ?? []) }
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
        job.status = 'failed'; job.errorCode = 'RUN_INTERRUPTED'; job.error = agentRunErrorMessage(job.errorCode, job.commits?.length ?? 0); job.finishedAt = job.updatedAt = new Date().toISOString(); job.revision++
        await this.storeJob(identity, job)
      }
      jobs.push(job)
    }
    return jobs
  }
  async invoke(identity: ChatIdentity, input: Record<string, unknown>, scheduled = false, receivedAt = Date.now()) {
    const { clientMessageId: id, text: instruction } = parseSend({ clientMessageId: input.requestId, text: input.instruction })
    logPipeline(identity.roomId, id, 'received', { receivedAtMs: receivedAt, ingressMs: Date.now() - receivedAt })
    if (typeof input.agentId !== 'string' || !input.agentId || input.agentId.length > 100) throw new Error('Invalid agent selection.')
    if (input.mode !== undefined && input.mode !== 'read' && input.mode !== 'write') throw new Error('Invalid request mode.')
    // Old clients and scheduled work retain the serialized writer path.
    const mode: AgentRunMode = scheduled ? 'write' : input.mode === 'read' ? 'read' : 'write'
    const profile = await this.deps.profile(identity, input.agentId)
    if (!profile) throw new SkillOperationError('AGENT_ACCESS_DENIED', 'authorization', 'Choose an agent you created in this organization.', false, 403)
    const key = this.key(identity, id)
    const now = new Date().toISOString()
    let newlyAccepted = false
    const job = await this.deps.storage.transaction(async (tx) => {
      newlyAccepted = false
      // Receipts outlive the 50-job history retention and are committed with
      // queue acceptance. A lost HTTP response must never enqueue twice.
      const receiptKey = `scheduler:receipt:${id}`
      if (scheduled && await tx.get(receiptKey)) return null
      const existing = await tx.get<PrivateAgentJob>(key)
      if (existing) {
        if (existing.agentId !== profile.id || existing.instruction !== instruction || (existing.mode ?? 'write') !== mode) throw new Error('Invalid reuse of an instruction ID.')
        if (scheduled) await tx.put(receiptKey, true)
        return existing
      }
      const queue = await tx.get<Entry[]>(QUEUE) ?? []
      if (queue.length >= 100 || queue.filter((entry) => entry.identity.userId === identity.userId).length >= 20) throw new Error('Too many queued requests. Wait for some work to finish.')
      const job: PrivateAgentJob = { id, agentId: profile.id, agentName: profile.name, instruction, reply: '', status: 'queued', createdAt: now, updatedAt: now, revision: 0, mode, commits: [], source: scheduled ? 'scheduled' : 'manual' }
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
      await this.putJob(tx, identity, job)
      if (scheduled) await tx.put(receiptKey, true)
      await tx.put(QUEUE, [...queue, { identity, id, mode }])
      // Persist a wakeup with acceptance, before relying on waitUntil.
      await scheduleEarlierAlarm(tx, Date.now() + 1000)
      newlyAccepted = true
      return job
    })
    if (!job) { this.wake(); return }
    if (newlyAccepted) logPipeline(identity.roomId, job.id, 'accepted', { mode, elapsedMs: Date.now() - Date.parse(job.createdAt) })
    // Execution must not await subscriber authorization or room-wide notifications.
    this.wake()
    this.deps.waitUntil(Promise.all([this.safeSend(identity, job), this.changed(identity)]).then(() => {}))
  }
  private requestArchive() {
    if (!this.deps.archive || this.archiving) return
    this.archiving = true
    this.deps.waitUntil((async () => {
      try {
        const success = await this.flushArchive()
        // A run may advance while its prior snapshot is being archived.
        if (success) await this.flushArchive()
        const pending = (await this.deps.storage.list({ prefix: OUTBOX, limit: 1 })).size > 0
        const first = (await this.deps.storage.get<Entry[]>(QUEUE))?.[0]
        const retry = pending ? Date.now() + (success ? 5000 : 30_000) : Infinity
        const recovery = first ? (first.deadline ? first.deadline + 1000 : Date.now() + 1000) : Infinity
        if (Number.isFinite(Math.min(retry, recovery))) await scheduleRoomAlarm(this.deps.storage, Math.min(retry, recovery))
      } catch {
        await scheduleRoomAlarm(this.deps.storage, Date.now() + 30_000)
      } finally { this.archiving = false }
    })())
  }
  wake() {
    this.requestArchive()
    this.readsRequested = true; this.writesRequested = true
    if (!this.pumpingReads) {
      this.pumpingReads = true
      this.deps.waitUntil((async () => {
        do { this.readsRequested = false; await this.pumpReads() } while (this.readsRequested)
      })().catch(() => scheduleRoomAlarm(this.deps.storage, Date.now() + 5000))
        .finally(() => { this.pumpingReads = false; if (this.readsRequested) this.wake() }))
    }
    if (!this.draining) {
      this.draining = true
      this.deps.waitUntil((async () => {
        do { this.writesRequested = false; await this.drain() } while (this.writesRequested)
      })().catch(() => scheduleRoomAlarm(this.deps.storage, Date.now() + 5000))
        .finally(() => { this.draining = false; if (this.writesRequested) this.wake() }))
    }
  }
  async cancel(identity: ChatIdentity, id: string) {
    const key = this.key(identity, id)
    this.active.get(key)?.abort()
    const owner = await this.deps.storage.transaction(async (tx) => {
      const queue = await tx.get<Entry[]>(QUEUE) ?? []
      const entry = queue.find((entry) => this.key(entry.identity, entry.id) === key)
      if (!entry) return
      if (entry.token) {
        entry.cancelRequested = true
        await tx.put(QUEUE, queue)
        return entry.identity
      }
      const job = await tx.get<PrivateAgentJob>(key)
      if (job) { job.status = 'failed'; job.errorCode = 'RUN_CANCELLED'; job.error = agentRunErrorMessage(job.errorCode, job.commits?.length ?? 0); job.finishedAt = job.updatedAt = new Date().toISOString(); job.revision++; await this.putJob(tx, identity, job) }
      await tx.put(QUEUE, queue.filter((item) => item !== entry))
      return entry.identity
    })
    // The run may have started while cancellation was being persisted.
    this.active.get(key)?.abort()
    const job = await this.deps.storage.get<PrivateAgentJob>(key)
    // Preserve scheduler metadata from the durable entry, not the browser caller.
    if (job) await this.safeSend(owner ?? identity, job)
    if (owner) await this.changed(owner)
  }
  async observed(identity: ChatIdentity, input: Record<string, unknown>) {
    if (typeof input.requestId !== 'string' || input.requestId.length > 100 ||
      typeof input.elapsedMs !== 'number' || !Number.isFinite(input.elapsedMs) || input.elapsedMs < 0 || input.elapsedMs > 86_400_000 ||
      typeof input.editorSaveMs !== 'number' || !Number.isFinite(input.editorSaveMs) || input.editorSaveMs < 0 || input.editorSaveMs > input.elapsedMs) return
    const job = await this.deps.storage.get<PrivateAgentJob>(this.key(identity, input.requestId))
    if (job) logPipeline(identity.roomId, job.id, 'browser.first-output', { clientElapsedMs: input.elapsedMs, editorSaveMs: input.editorSaveMs })
  }
  private async pumpReads(): Promise<void> {
    for (;;) {
      const queue = (await this.deps.storage.get<Entry[]>(QUEUE) ?? []).filter((entry) => entry.mode === 'read')
      // Orphans hold their slots until the watchdog expires. Never replay a run.
      for (const entry of queue.filter((entry) => entry.token && !this.active.has(this.key(entry.identity, entry.id)))) {
        const job = await this.deps.storage.get<PrivateAgentJob>(this.key(entry.identity, entry.id))
        if (!job || job.status === 'complete' || job.status === 'failed') {
          await this.remove(entry)
          return this.pumpReads()
        }
        if ((entry.deadline ?? 0) > Date.now()) {
          await scheduleRoomAlarm(this.deps.storage, entry.deadline! + 1000)
        } else {
          job.status = 'failed'; job.errorCode = 'RUN_INTERRUPTED'; job.error = agentRunErrorMessage(job.errorCode, job.commits?.length ?? 0); job.finishedAt = job.updatedAt = new Date().toISOString(); job.revision++
          await this.storeJob(entry.identity, job)
          await this.safeSend(entry.identity, job)
          await this.remove(entry)
          return this.pumpReads()
        }
      }
      const running = queue.filter((entry) => entry.token)
      if (running.length >= 3) return
      // Reserve one room slot for other users; per-user queued limits still apply.
      const entry = queue.find((entry) => !entry.token && running.filter((active) => active.identity.userId === entry.identity.userId).length < 2)
      if (!entry) return
      const key = this.key(entry.identity, entry.id)
      const job = await this.deps.storage.get<PrivateAgentJob>(key)
      if (!job || job.status === 'failed' || job.status === 'complete') { await this.remove(entry); continue }
      const profile = await this.deps.profile(entry.identity, job.agentId)
      if (!profile || !await this.deps.canAccess(entry.identity)) {
        job.status = 'failed'; job.errorCode = 'ACCESS_DENIED'; job.error = agentRunErrorMessage(job.errorCode, job.commits?.length ?? 0); job.finishedAt = job.updatedAt = new Date().toISOString(); job.revision++
        await this.storeJob(entry.identity, job); await this.safeSend(entry.identity, job); await this.remove(entry); continue
      }
      const claimed = await this.deps.storage.transaction(async (tx) => {
        const current = await tx.get<Entry[]>(QUEUE) ?? []
        const saved = current.find((item) => this.key(item.identity, item.id) === key)
        if (!saved || saved.token) return false
        saved.token = crypto.randomUUID(); saved.deadline = Date.now() + 240_000
        Object.assign(entry, saved)
        await tx.put(QUEUE, current); await scheduleEarlierAlarm(tx, saved.deadline + 1000)
        return true
      })
      if (!claimed) continue
      this.deps.waitUntil(this.run(entry, profile, job).then(() => this.remove(entry))
        .catch(() => scheduleRoomAlarm(this.deps.storage, Date.now() + 5000))
        .finally(() => { this.wake() }))
    }
  }
  private async safeSend(identity: ChatIdentity, job: PrivateAgentJob) {
    const key = this.key(identity, job.id), snapshot = structuredClone(job)
    if (this.deps.archive) {
      const signature = JSON.stringify([job.status, job.commits?.length, job.taskCommits?.length, job.activities])
      const previous = this.lastArchived.get(key)
      if (!previous || previous.signature !== signature || Date.now() - previous.at >= 5000) {
        this.lastArchived.set(key, { at: Date.now(), signature })
        this.requestArchive()
      }
    }
    // Preserve revisions across acceptance, streaming and terminal notifications.
    // A disconnected subscriber must not change execution/commit state.
    const delivery = (this.deliveries.get(key) ?? Promise.resolve()).then(async () => {
      try { await this.deps.send(identity, { type: 'agent.update', job: snapshot }) } catch { /* replay via history */ }
    })
    this.deliveries.set(key, delivery)
    await delivery
    if (this.deliveries.get(key) === delivery) this.deliveries.delete(key)
  }
  private changed(identity: ChatIdentity): Promise<void> {
    this.notificationRequested = true
    if (this.notification) return this.notification
    this.notification = (async () => {
      do {
        this.notificationRequested = false
        try { await this.deps.changed?.(identity) } catch { /* polling recovers missed notifications */ }
      } while (this.notificationRequested)
    })().finally(() => { this.notification = undefined })
    return this.notification
  }
  private async drain() {
    for (;;) {
      const entry = (await this.deps.storage.get<Entry[]>(QUEUE) ?? []).find((entry) => entry.mode !== 'read')
      if (!entry) return
      const key = this.key(entry.identity, entry.id)
      const job = await this.deps.storage.get<PrivateAgentJob>(key)
      if (!job) { await this.remove(entry); continue }
      if (job.status === 'complete' || job.status === 'failed') {
        if (entry.token) await this.deps.release(entry.identity, entry.token)
        await this.remove(entry); continue
      }
      if (entry.token) {
        if ((entry.deadline ?? 0) > Date.now()) {
          await scheduleRoomAlarm(this.deps.storage, entry.deadline! + 1000); return
        }
        job.status = 'failed'; job.errorCode = 'RUN_INTERRUPTED'; job.error = agentRunErrorMessage(job.errorCode, job.commits?.length ?? 0); job.finishedAt = job.updatedAt = new Date().toISOString(); job.revision++
        await this.storeJob(entry.identity, job)
        await this.deps.release(entry.identity, entry.token)
        await this.safeSend(entry.identity, job)
        await this.remove(entry); continue
      }
      if (!await this.deps.canAccess(entry.identity)) {
        job.status = 'failed'; job.errorCode = 'ACCESS_DENIED'; job.error = agentRunErrorMessage(job.errorCode, job.commits?.length ?? 0); job.finishedAt = job.updatedAt = new Date().toISOString(); job.revision++
        await this.storeJob(entry.identity, job); await this.safeSend(entry.identity, job); await this.remove(entry); continue
      }
      const profile = await this.deps.profile(entry.identity, job.agentId)
      if (!profile) {
        job.status = 'failed'; job.errorCode = 'AGENT_ACCESS_DENIED'; job.error = agentRunErrorMessage(job.errorCode, job.commits?.length ?? 0); job.finishedAt = job.updatedAt = new Date().toISOString(); job.revision++
        await this.storeJob(entry.identity, job); await this.safeSend(entry.identity, job); await this.remove(entry); continue
      }
      const token = crypto.randomUUID()
      if (!await this.deps.acquire(entry.identity, token)) { await scheduleRoomAlarm(this.deps.storage, Date.now() + 5000); return }
      // Lease extends beyond execution deadline. Recovery waits for its expiry
      // before releasing a potentially orphaned run.
      entry.token = token; entry.deadline = Date.now() + 240_000
      try {
        await this.deps.storage.transaction(async (tx) => {
          const queue = await tx.get<Entry[]>(QUEUE) ?? []
          const index = queue.findIndex((item) => item.mode !== 'read')
          if (index < 0 || this.key(queue[index].identity, queue[index].id) !== key) throw new Error('Queue head changed')
          queue[index] = entry; await tx.put(QUEUE, queue); await scheduleEarlierAlarm(tx, entry.deadline! + 1000)
        })
        await this.run(entry, profile, job)
      } finally { await this.deps.release(entry.identity, token) }
      await this.remove(entry)
    }
  }
  private async remove(entry: Entry) {
    this.lastArchived.delete(this.key(entry.identity, entry.id))
    this.requestArchive()
    await this.deps.storage.transaction(async (tx) => {
      const queue = await tx.get<Entry[]>(QUEUE) ?? []
      await tx.put(QUEUE, queue.filter((item) => this.key(item.identity, item.id) !== this.key(entry.identity, entry.id)))
      await tx.delete(ACTIVITIES + this.key(entry.identity, entry.id))
      const checkpoints = await tx.list({ prefix: `room-work:checkpoint:${encodeURIComponent(this.key(entry.identity, entry.id))}:` })
      for (const key of checkpoints.keys()) await tx.delete(key)
    })
    this.deps.waitUntil(this.changed(entry.identity))
  }
  private async run(entry: Entry, profile: PrivateAgentProfile, job: PrivateAgentJob) {
    const key = this.key(entry.identity, entry.id)
    const controller = new AbortController()
    this.active.set(key, controller)
    const started = Date.now()
    const seen = new Set<PipelineStage>()
    const stage = (name: PipelineStage) => {
      if (seen.has(name) && name !== 'committed') return
      seen.add(name)
      logPipeline(entry.identity.roomId, job.id, name, { mode: entry.mode ?? 'write', elapsedMs: Date.now() - Date.parse(job.createdAt), runMs: Date.now() - started })
    }
    let pending: Promise<void> | undefined
    let latest: PrivateAgentJob | undefined
    let deliveryError: unknown
    let lastPersisted = 0
    const snapshot = () => {
      job.updatedAt = new Date().toISOString(); job.revision++
      return structuredClone(job)
    }
    const publish = () => {
      latest = snapshot()
      if (pending) return
      pending = (async () => {
        while (latest) {
          const update = latest; latest = undefined
          // Persist checkpoints less often than socket output, with one in-flight
          // delivery and at most one pending cumulative snapshot per run.
          if (Date.now() - lastPersisted >= 1000) {
            await this.storeJob(entry.identity, update); lastPersisted = Date.now()
          }
          await this.safeSend(entry.identity, update)
          if (update.reply) stage('output.sent')
        }
      })().catch((error: unknown) => { deliveryError = error }).finally(() => { pending = undefined })
    }
    const save = async (waitForDelivery = true) => {
      // A terminal or committed state must follow every in-flight partial update.
      await pending
      latest = undefined
      await this.storeJob(entry.identity, snapshot())
      const delivery = this.safeSend(entry.identity, job)
      if (waitForDelivery) await delivery
      else this.deps.waitUntil(delivery)
      if (job.reply) stage('output.sent')
    }
    const activities = new Map<string, AgentWorkActivity>()
    const colors = new Map<string, AvatarColor>()
    const deadline = AbortSignal.timeout(RUN_MS - 5000)
    try {
      const current = (await this.deps.storage.get<Entry[]>(QUEUE) ?? []).find((item) => this.key(item.identity, item.id) === key)
      if (current?.cancelRequested) controller.abort()
      controller.signal.throwIfAborted()
      stage('dequeued'); job.status = 'running'; job.startedAt = new Date().toISOString(); await save(false)
      const messages: PrivateAgentMessage[] = [{ role: 'user', content: job.instruction }]
      let budget = 32_000 - job.instruction.length
      const history = entry.identity.scheduledDeliveryId ? [] : await this.history(entry.identity)
      const preceding = history.slice(0, Math.max(0, history.findIndex((item) => item.id === job.id)))
      for (const old of preceding.filter((item) => item.agentId === profile.id && (item.status === 'complete' || item.status === 'failed' && !!item.commits?.length)).slice(-10).reverse()) {
        const reply = [old.reply, old.status === 'failed' ? `The previous attempt stopped after saving these versions. Re-read them before continuing: ${JSON.stringify(old.commits)}` : ''].filter(Boolean).join('\n')
        if (old.instruction.length + reply.length > budget) break
        messages.unshift({ role: 'user', content: old.instruction }, { role: 'assistant', content: reply })
        budget -= old.instruction.length + reply.length
      }
      const signal = AbortSignal.any([controller.signal, deadline])
      const context: AgentRunContext = {
        id: job.id, token: entry.mode === 'read' ? '' : entry.token!, mode: entry.mode ?? 'write', stage,
        issue: (issue) => {
          job.issues = [...(job.issues ?? []), issue].slice(-32)
        },
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
          job.activities = [...activities.values()]
          await this.deps.storage.put(ACTIVITIES + key, job.activities)
          await save(false)
          this.deps.waitUntil(this.changed(entry.identity))
        },
        committed: async (commit) => {
          if (!job.commits?.some((saved) => saved.documentId === commit.documentId && saved.versionId === commit.versionId)) job.commits = [...(job.commits ?? []), commit]
          stage('committed'); await save(); this.deps.waitUntil(this.changed(entry.identity))
        },
        taskCommitted: async (commit) => { job.taskCommits = [...(job.taskCommits ?? []), commit]; stage('committed'); await save(); this.deps.waitUntil(this.changed(entry.identity)) },
        preview: async (toolCallId, input) => {
          signal.throwIfAborted()
          // Ephemeral, owner-only drafts; never persist them as document versions.
          try { await this.deps.send(entry.identity, { type: 'agent.document-preview', runId: job.id, toolCallId, input, author: { agentId: profile.id, agentName: profile.name, color: colors.get(profile.id) ?? profile.color, requestedBy: { id: entry.identity.userId, name: entry.identity.name || 'Room member' } } }) } catch { /* final content is recovered via work/history */ }
        },
        checkpoint: async (id, value) => { signal.throwIfAborted(); await this.deps.storage.put(`room-work:checkpoint:${encodeURIComponent(key)}:${id}`, value) },
      }
      await context.activity({ runId: job.id, agentId: profile.id, agentName: profile.name, color: profile.color, phase: 'planning' }, profile.id)
      let lastSent = 0
      for await (const delta of this.deps.stream(profile, messages, signal, entry.identity, context)) {
        signal.throwIfAborted()
        if (deliveryError) throw deliveryError
        stage('reply.first-delta')
        const reply = job.reply + delta
        // DO values have a byte limit; Unicode prompts/replies can exceed it
        // well before reaching the character limit. Keep the last safe reply.
        if (reply.length > 32_000 || new TextEncoder().encode(JSON.stringify({ ...job, reply })).byteLength > 110_000) throw new AgentRunError('RESPONSE_TOO_LARGE')
        job.reply = reply
        if (Date.now() - lastSent >= 200) {
          publish(); lastSent = Date.now()
        }
      }
      if (!job.reply.trim()) throw new AgentRunError('EMPTY_RESPONSE')
      if (!await this.deps.canAccess(entry.identity)) throw new AgentRunError('ACCESS_DENIED')
      job.status = 'complete'; job.finishedAt = new Date().toISOString(); job.activities = []; await save(); stage('complete')
    } catch (error) {
      job.errorCode = controller.signal.aborted ? 'RUN_CANCELLED' : deadline.aborted ? 'RUN_TIMEOUT'
        : error instanceof AgentRunError || error instanceof SkillOperationError ? error.code
        : 'INTERNAL_ERROR'
      job.status = 'failed'; job.error = agentRunErrorMessage(job.errorCode, job.commits?.length ?? 0)
      console.error('[agent-run]', JSON.stringify({ event: 'run.failed', timestamp: new Date().toISOString(),
        roomId: entry.identity.roomId, runId: job.id, agentId: profile.id, errorCode: job.errorCode,
        durationMs: Date.now() - started, timeoutMs: RUN_MS - 5000, savedBatches: job.commits?.length ?? 0,
        savedVersions: job.commits ?? [], issueCount: job.issues?.length ?? 0, ...errorDiagnostics(error) }))
      job.finishedAt = new Date().toISOString(); job.activities = []
      await save(); stage('failed')
    } finally { controller.abort(); this.active.delete(key) }
  }
}
