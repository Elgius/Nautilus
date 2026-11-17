import { Hono } from 'hono'
import { createUIMessageStreamResponse, toUIMessageStream } from 'ai'
import { bodyLimit } from 'hono/body-limit'
import { HTTPException } from 'hono/http-exception'
import { createAgentModel, createLLMAgent, parseAgentChat } from './ai'
import { findTurn, hubIds, saveTurn } from './hub-history'
import type { AppEnv } from './index'

// Mounted behind the existing session, live membership, and origin checks.
export const agentChat = new Hono<AppEnv>()
agentChat.post('/:agentId/chat', bodyLimit({ maxSize: 256 * 1024 }), async (c) => {
  const body = await c.req.json().catch(() => {
    throw new HTTPException(400, { message: 'Enter a valid agent chat request.' })
  })
  const input = parseAgentChat(body)
  const history = body.history === undefined ? undefined : hubIds.safeParse(body.history)
  if (history && (!history.success || input.stream)) throw new HTTPException(400, { message: 'Invalid saved chat request.' })
  const profile = await c.get('db').agent.findFirst({
    where: { id: c.req.param('agentId'), organizationId: c.get('organizationId') },
    select: { id: true, name: true, role: true, rules: true },
  })
  if (!profile) throw new HTTPException(404, { message: 'Agent not found.' })
  const prompt = input.messages[input.messages.length - 1].content
  const owner = history?.success ? { organizationId: c.get('organizationId'), userId: c.get('session').user.id } : undefined
  if (owner && history?.success) {
    const turn = await findTurn(c.get('db'), owner, history.data.id)
    if (turn) {
      if (turn.agentId !== profile.id || turn.conversationId !== history.data.conversationId || turn.prompt !== prompt) {
        throw new HTTPException(409, { message: 'This turn ID is already in use.' })
      }
      return c.json({ agentId: profile.id, text: turn.reply, turn })
    }
  }
  const agent = createLLMAgent(profile, createAgentModel(c.env))
  const generate = async () => {
    const options = { messages: input.messages, abortSignal: c.req.raw.signal }
    if (input.stream) {
      const result = await agent.stream(options)
      return createUIMessageStreamResponse({
        stream: toUIMessageStream({
          stream: result.stream,
          // Provider errors may include credentials, prompts, or internal URLs.
          onError: () => 'The agent could not complete this response. Please try again.',
        }),
      })
    }
    const result = await agent.generate(options)
    return { text: result.text, finishReason: result.finishReason, usage: result.totalUsage }
  }
  const result = await generate().catch(() => {
    throw new HTTPException(502, { message: 'The agent could not complete this response. Please try again.' })
  })
  if (result instanceof Response) return result
  if (owner && history?.success) {
    if (!result.text.trim()) throw new HTTPException(502, { message: 'The agent returned an empty reply.' })
    const turn = await saveTurn(c.get('db'), owner,
      { ...history.data, agentId: profile.id, prompt, reply: result.text })
    return c.json({ ...result, agentId: profile.id, text: turn.reply, turn })
  }
  return c.json({ agentId: profile.id, ...result })
})
