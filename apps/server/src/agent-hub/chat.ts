import { buildHubCitations } from '../../../../shared/agent-citations'
import type { HubSource } from '../../../../shared/room-chat'
import { createDatabase, type Database } from '../db'
import { createKnowledgeSkill } from './knowledge'
import { createDiscoverySkill } from './discovery'
import { Hono } from 'hono'
import { createUIMessageStreamResponse, toUIMessageStream } from 'ai'
import { bodyLimit } from 'hono/body-limit'
import { HTTPException } from 'hono/http-exception'
import { createAgentModel, createLLMAgent, parseAgentChat } from '../ai'
import type { AppEnv } from '../index'

// Mounted behind the existing session, live membership, and origin checks.
export const agentChat = new Hono<AppEnv>()
agentChat.post('/:agentId/chat', bodyLimit({ maxSize: 256 * 1024 }), async (c) => {
  const input = parseAgentChat(await c.req.json().catch(() => {
    throw new HTTPException(400, { message: 'Enter a valid agent chat request.' })
  }))
  const profile = await c.get('db').agent.findFirst({
    where: { id: c.req.param('agentId'), organizationId: c.get('organizationId') },
    select: { id: true, name: true, role: true, rules: true },
  })
  if (!profile) throw new HTTPException(404, { message: 'Agent not found.' })
  const model = createAgentModel(c.env)
  const identity = { organizationId: c.get('organizationId'), userId: c.get('session').user.id }
  const sessionId = c.get('session').session.id
  const authorize = async (db: Database) => {
    if (!await db.session.findFirst({ where: { id: sessionId, userId: identity.userId, expiresAt: { gt: new Date() } }, select: { id: true } }) ||
      !await db.member.findUnique({ where: { organizationId_userId: identity }, select: { id: true } })) throw new Error('Agent access expired.')
  }
  // Streamed tools may run after the HTTP middleware disconnects its request DB.
  const withDatabase = async <T>(action: (db: Database) => Promise<T>) => {
    const db = createDatabase(c.env.DATABASE_URL)
    try { await authorize(db); return await action(db) } finally { await db.$disconnect() }
  }
  const sources = new Map<string, HubSource>()
  const recordSources = async (incoming: HubSource[]) => { for (const source of incoming) sources.set(source.id, source) }
  const agent = createLLMAgent(profile, model, [
    createDiscoverySkill(withDatabase, identity.organizationId, identity.userId),
    createKnowledgeSkill(withDatabase, identity, ['ORGANIZATION'], c.req.raw.signal, recordSources),
  ])
  try {
    const options = { messages: input.messages, abortSignal: c.req.raw.signal }
    if (input.stream) {
      const result = await agent.stream(options)
      let responseText = ''
      return createUIMessageStreamResponse({
        stream: toUIMessageStream({
          stream: result.stream,
          // Provider errors may include credentials, prompts, or internal URLs.
          onError: () => 'The agent could not complete this response. Please try again.',
        }).pipeThrough(new TransformStream({ transform(chunk, controller) {
          if (chunk.type === 'text-delta') responseText += chunk.delta
          if (chunk.type === 'finish') controller.enqueue({ type: 'data-citations', data: { citations: buildHubCitations(responseText, [...sources.values()]) } })
          controller.enqueue(chunk)
        } })),
      })
    }
    const result = await agent.generate(options)
    return c.json({ agentId: profile.id, text: result.text, citations: buildHubCitations(result.text, [...sources.values()]), finishReason: result.finishReason, usage: result.totalUsage })
  } catch {
    throw new HTTPException(502, { message: 'The agent could not complete this response. Please try again.' })
  }
})
