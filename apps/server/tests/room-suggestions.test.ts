import { expect, test, spyOn } from 'bun:test'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { RoomSuggestions, suggestionHistory, validateSuggestions, generateRoomSuggestions, type SuggestionMessage } from '../src/room-suggestions'
import { createAgentModel } from '../src/ai'
import { rooms } from '../src/rooms'
import type { AppEnv } from '../src/index'
import type { Database } from '../src/db'
import type { Bindings } from '../src/env'

const identity = { organizationId: 'org', roomId: 'room', userId: 'user', sessionId: 'session' }
const output = { suggestions: ['Compare the launch options', 'Summarize the next steps', 'Draft a launch checklist'] }
const message = (id: string): SuggestionMessage => ({ id, text: `Message ${id}`, createdAt: new Date(1000), editedAt: null })
function harness() {
  const data = new Map<string, unknown>()
  const state = { allowed: true, messages: [message('1')], calls: 0, now: 100_000, fail: false }
  const deps = {
    storage: { get: async (key: string) => data.get(key), put: async (key: string, value: unknown) => { data.set(key, value) } } as unknown as Pick<DurableObjectStorage, 'get' | 'put'>,
    canAccess: async () => state.allowed,
    history: async () => state.messages,
    generate: async () => { state.calls++; if (state.fail) throw new Error('provider-secret'); return output },
    now: () => state.now,
  }
  return { state, deps, service: new RoomSuggestions(deps) }
}

test('history is the latest five public room messages, tenant-scoped and chronological', async () => {
  let query: unknown
  const db = { roomMessage: { findMany: async (input: unknown) => { query = input; return ['5', '4', '3', '2', '1'].map(message) } } } as unknown as Database
  expect((await suggestionHistory(db, identity)).map(({ id }) => id)).toEqual(['1', '2', '3', '4', '5'])
  expect(query).toEqual({
    where: { organizationId: 'org', roomId: 'room', authorAgentId: null, authorUserId: { not: null } },
    select: { id: true, text: true, createdAt: true, editedAt: true },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 5,
  })
})

test('cache survives service recreation; edits invalidate it and cooldown limits generation', async () => {
  const { service, state, deps } = harness()
  expect(await service.get(identity)).toEqual(output)
  expect(await new RoomSuggestions(deps).get(identity)).toEqual(output)
  expect(state.calls).toBe(1)
  state.messages = [{ ...message('1'), text: 'Edited message', editedAt: new Date(2000) }]
  expect(await service.get(identity)).toEqual({ suggestions: [], retryAfterMs: 30_000 })
  state.now += 30_000
  expect(await service.get(identity)).toEqual(output)
  expect(state.calls).toBe(2)
})

test('concurrent viewers share generation and access is checked before cache and after generation', async () => {
  const { state, deps } = harness()
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  let started!: () => void
  const entered = new Promise<void>((resolve) => { started = resolve })
  deps.generate = async () => { state.calls++; started(); await gate; return output }
  const service = new RoomSuggestions(deps)
  const first = service.get(identity), second = service.get(identity)
  await entered; release()
  expect(await Promise.all([first, second])).toEqual([output, output])
  expect(state.calls).toBe(1)
  state.allowed = false
  await expect(service.get(identity)).rejects.toThrow('Join this room')
  state.allowed = true; state.now += 30_000; state.messages = [message('2')]
  deps.generate = async () => { state.allowed = false; return output }
  await expect(service.get(identity)).rejects.toThrow('Room access expired')
})

test('empty rooms skip OpenAI; failures fall back and consume the durable cooldown', async () => {
  const { state, service, deps } = harness()
  state.messages = []
  expect(await service.get(identity)).toEqual({ suggestions: [] }); expect(state.calls).toBe(0)
  state.messages = [message('1')]; state.fail = true
  expect(await service.get(identity)).toEqual({ suggestions: [] })
  expect(await new RoomSuggestions(deps).get(identity)).toEqual({ suggestions: [], retryAfterMs: 30_000 })
  expect(state.calls).toBe(1)
})

test('invalid, duplicate, multiline and mention suggestions are rejected', () => {
  for (const suggestions of [[], ['short'], ['Same text', 'same text', 'Third prompt'], ['hello\nworld', 'Second prompt', 'Third prompt'], ['Ask @Scout', 'Second prompt', 'Third prompt'], ['x'.repeat(65), 'Second prompt', 'Third prompt']]) {
    expect(() => validateSuggestions({ suggestions })).toThrow()
  }
})

test('generation uses OpenAI Responses, strict structured output, bounded context, and no provider storage', async () => {
  let request: Record<string, unknown> = {}
  const fetch = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(async (url: string | URL | Request, init?: RequestInit) => {
    expect(String(url)).toBe('https://api.openai.com/v1/responses')
    request = JSON.parse(String(init?.body))
    return Response.json({ id: 'resp_test', model: 'gpt-test', created_at: 1, status: 'completed',
      usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 },
      output: [{ type: 'message', id: 'msg_test', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify(output), annotations: [] }] }],
    })
  }, { preconnect: globalThis.fetch.preconnect }))
  try {
    const messages = Array.from({ length: 6 }, (_, index) => ({ ...message(String(index)), text: index === 0 ? 'excluded-oldest' : 'a'.repeat(20_000) }))
    expect(await generateRoomSuggestions(messages, createAgentModel({ OPENAI_API_KEY: 'test', LLM_MODEL: 'gpt-test' } as Bindings))).toEqual(output)
    expect(request).toMatchObject({ store: false, max_output_tokens: 1024, text: { format: { type: 'json_schema', name: 'room_suggestions', strict: true } } })
    expect(JSON.stringify(request.input)).not.toContain('excluded-oldest')
    expect(JSON.stringify(request.input).length).toBeLessThan(22_000)
    expect(request).not.toHaveProperty('previous_response_id')
  } finally { fetch.mockRestore() }
})

test('route derives identity from session and checks membership before contacting the room coordinator', async () => {
  let allowed = false, forwarded: unknown
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('organizationId', 'org')
    c.set('session', { user: { id: 'user' }, session: { id: 'session' } } as AppEnv['Variables']['session'])
    c.set('db', {
      room: { findUnique: async () => ({ id: 'room' }) },
      session: { findFirst: async () => ({ id: 'session' }) },
      roomMember: { findFirst: async () => allowed ? { organizationMemberId: 'member' } : null },
    } as unknown as Database)
    await next()
  })
  app.route('/rooms', rooms)
  app.onError((error, c) => c.json({ error: error.message }, error instanceof HTTPException ? error.status : 500))
  const env = { ROOM_CHAT: {
    idFromName: (name: string) => { expect(name).toBe(JSON.stringify(['org', 'room'])); return 'coordinator' },
    get: () => ({ fetch: async (request: Request) => { forwarded = await request.json(); return Response.json(output) } }),
  } }
  const send = () => app.request('/rooms/room/suggestions', { method: 'POST', body: JSON.stringify({ userId: 'attacker', messages: ['injected'] }) }, env)
  expect((await send()).status).toBe(403); expect(forwarded).toBeUndefined()
  allowed = true
  const response = await send()
  expect(response.status).toBe(200); expect(await response.json()).toEqual(output)
  expect(forwarded).toEqual(identity)
  expect(response.headers.get('cache-control')).toBe('no-store')
})
