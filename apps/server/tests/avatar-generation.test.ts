import { expect, spyOn, test } from 'bun:test'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { MockLanguageModelV4 } from 'ai/test'
import { APICallError } from 'ai'
import { parseAvatarDesign, type LegacyAvatarDesign, type BotAvatarDesign } from '../../../shared/avatar-design'
import { generateAvatarPreview } from '../src/avatar-generation'
import { createAvatarGenerationRouter } from '../src/avatar-generation-route'
import type { AppEnv } from '../src/index'

const legacyAvatar: LegacyAvatarDesign = {
  bodyPath: 'M 22 9 L 78 9 Q 91 9 91 22 L 91 78 Q 91 91 78 91 L 22 91 Q 9 91 9 78 L 9 22 Q 9 9 22 9 Z',
  color: '#9c5bfa',
  eyes: [{ cx: 38, cy: 56, rx: 5, ry: 7 }, { cx: 64, cy: 56, rx: 5, ry: 7 }],
}

const avatar: BotAvatarDesign = {
  color: '#9c5bfa',
  definition: { version: 1, id: 'box', name: 'Box', body: { path: 'M20 20L80 20L80 80L20 80Z' }, eyes: { x: 50, y: 46, spacing: 15, scale: 1 } },
}

function harness(output: unknown = avatar, failure?: Error) {
  const model = new MockLanguageModelV4({ doGenerate: {
    content: [{ type: 'text', text: JSON.stringify(output) }],
    finishReason: { unified: 'stop', raw: undefined }, warnings: [],
    usage: {
      inputTokens: { total: 3, noCache: 3, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 2, text: 2, reasoning: undefined },
    },
  } })
  if (failure) {
    const fail = new MockLanguageModelV4({ doGenerate: async () => { throw failure } })
    model.doGenerate = (options) => { model.doGenerateCalls.push(options); return fail.doGenerate(options) }
  }
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    // Any database access by this route is a regression: generation is preview-only.
    c.set('db', new Proxy({} as AppEnv['Variables']['db'], { get() { throw new Error('Unexpected database access') } }))
    await next()
  })
  app.route('/preview', createAvatarGenerationRouter(() => model))
  app.onError((error, c) => c.json({ error: error.message }, error instanceof HTTPException ? error.status : 500))
  const request = (body: unknown) => app.request('/preview', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  return { app, request, model }
}

test('generates structured preview geometry without looking up or saving an agent', async () => {
  const { request, model } = harness()
  const response = await request({ description: 'A friendly purple cat.', model: 'override', organizationId: 'other' })
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ avatar })
  expect(model.doGenerateCalls).toHaveLength(1)
  expect(model.doGenerateCalls[0].responseFormat?.type).toBe('json')
  const prompt = JSON.stringify(model.doGenerateCalls[0].prompt)
  expect(prompt).toContain('A friendly purple cat.')
  expect(prompt).toContain('Face first')
  expect(prompt).toContain('Nautilus output envelope')
  expect(prompt).toContain('≤ 40')
  expect(model.doGenerateCalls[0].responseFormat).toMatchObject({
    schema: { properties: { definition: { properties: { eyes: { properties: { spacing: { maximum: 40 } } } } } } },
  })
  expect(prompt).not.toContain('override')
})

test('rejects malformed descriptions and excessive bodies before calling the model', async () => {
  const { request, model, app } = harness()
  for (const body of [null, [], {}, { description: 5 }, { description: ' ' }, { description: 'a'.repeat(2001) }]) {
    expect((await request(body)).status).toBe(400)
  }
  expect((await request({ description: 'a'.repeat(17000) })).status).toBe(413)
  expect((await app.request('/preview', { method: 'POST', body: '{broken' })).status).toBe(400)
  expect(model.doGenerateCalls).toHaveLength(0)
})

test('rejects unsafe and malformed generated SVG details with a safe retryable error', async () => {
  for (const invalid of [
    legacyAvatar,
    { ...avatar, definition: { ...avatar.definition, body: { path: '<svg onload="alert(1)">' } } },
    { ...avatar, definition: { ...avatar.definition, body: { path: 'M10 10 L101 10 L10 80 Z' } } },
    { ...avatar, definition: { ...avatar.definition, body: { path: 'M10 10 C20 20 Z' } } },
    { ...avatar, definition: { ...avatar.definition, body: { path: 'M10 10 Z' } } },
    { ...avatar, definition: { ...avatar.definition, eyes: { x: 5, y: 5, spacing: 15, scale: 1 } } },
    { ...avatar, definition: { ...avatar.definition, eyes: { x: 50, y: 46, spacing: 1, scale: 1 } } },
    { ...avatar, definition: { ...avatar.definition, version: 2 } },
    { ...avatar, definition: { ...avatar.definition, onload: 'evil' } },
    { ...avatar, color: 'url(https://secret.example)' },
    { ...avatar, onload: 'evil' },
  ]) {
    const { request } = harness(invalid)
    const response = await request({ description: 'A cat.' })
    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ error: 'The generated avatar wasn’t valid. Please try generating it again.' })
  }
})

test('normalizes valid geometry and strips fields the renderer does not support', () => {
  expect(parseAvatarDesign({ ...legacyAvatar, bodyPath: legacyAvatar.bodyPath.replaceAll(' ', ','), onload: 'alert(1)', eyes: legacyAvatar.eyes.map(eye => ({ ...eye, style: 'malicious' })) })).toEqual(legacyAvatar)
  expect(() => parseAvatarDesign({ ...legacyAvatar, bodyPath: 'M 1e999 10 L 80 10 L 80 80 Z' })).toThrow()
  expect(() => parseAvatarDesign({ ...legacyAvatar, bodyPath: 'M 10 10 L 80 10 L 80 80 Z'.repeat(200) })).toThrow()
})

test('accepts the maximum eye spacing and rejects values above the renderer limit', async () => {
  const wide = { ...avatar, definition: { ...avatar.definition, body: { path: 'M8 8L92 8L92 92L8 92Z' }, eyes: { ...avatar.definition.eyes, spacing: 40 } } }
  expect((await harness(wide).request({ description: 'A wide box.' })).status).toBe(200)
  const invalid = { ...wide, definition: { ...wide.definition, eyes: { ...wide.definition.eyes, spacing: 41 } } }
  expect((await harness(invalid).request({ description: 'A wide box.' })).status).toBe(502)
})

test('provider failures do not expose upstream details', async () => {
  const model = new MockLanguageModelV4({ doGenerate: async () => { throw new Error('secret-provider-detail') } })
  await expect(generateAvatarPreview('A cat.', model)).rejects.toMatchObject({ status: 502, message: 'Couldn’t generate this avatar. Please try again.' })
})

test('a cancelled preview request aborts provider generation', async () => {
  const controller = new AbortController()
  let providerAborted = false
  const model = new MockLanguageModelV4({ doGenerate: async (options) => {
    const signal = options.abortSignal!
    controller.abort()
    providerAborted = signal.aborted
    signal.throwIfAborted()
    throw new Error('Expected cancellation')
  } })
  await expect(generateAvatarPreview('A cat.', model, controller.signal)).rejects.toMatchObject({ status: 408 })
  expect(providerAborted).toBe(true)
})

function providerError(statusCode: number, retryable = true, responseBody?: string) {
  return new APICallError({
    message: 'secret-provider-detail', url: 'https://provider.invalid/?key=secret',
    requestBodyValues: { prompt: 'private description' }, statusCode,
    responseHeaders: { 'retry-after-ms': '0' }, isRetryable: retryable,
    responseBody,
  })
}

test('retries temporary OpenAI failures and recovers without changing the description', async () => {
  const { model: success } = harness()
  let attempts = 0
  const model = new MockLanguageModelV4({ doGenerate: async (options) => {
    if (++attempts <= 2) throw providerError(503)
    return success.doGenerate(options)
  } })
  expect(await generateAvatarPreview('a game console', model)).toEqual(avatar)
  expect(attempts).toBe(3)
  expect(JSON.stringify(success.doGenerateCalls[0].prompt)).toContain('a game console')
})

test('exhausted retries report service unavailability and log no sensitive provider details', async () => {
  const log = spyOn(console, 'warn').mockImplementation(() => {})
  const model = new MockLanguageModelV4({ doGenerate: async () => { throw providerError(503) } })
  try {
    await expect(generateAvatarPreview('a game console', model)).rejects.toMatchObject({
      status: 503, message: 'The avatar service is temporarily unavailable. Please try again shortly.',
    })
    expect(model.doGenerateCalls).toHaveLength(3)
    expect(log).toHaveBeenCalledWith('Avatar generation failed', { reason: 'provider_error', providerStatus: 503 })
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret')
    expect(JSON.stringify(log.mock.calls)).not.toContain('private description')
  } finally { log.mockRestore() }
})

test('rate limits and timeouts have separate safe errors', async () => {
  const limited = new MockLanguageModelV4({ doGenerate: async () => { throw providerError(429) } })
  await expect(generateAvatarPreview('a game console', limited)).rejects.toMatchObject({ status: 429, message: 'Avatar generation is temporarily rate-limited. Please wait before trying again.' })
  expect(limited.doGenerateCalls).toHaveLength(1)
  const slow = new MockLanguageModelV4({ doGenerate: async () => { throw new DOMException('secret timeout details', 'TimeoutError') } })
  await expect(generateAvatarPreview('a game console', slow)).rejects.toMatchObject({ status: 504, message: 'Avatar generation took too long. Please try again.' })
})

test('OpenAI quota exhaustion is not retried and does not fabricate a reset time', async () => {
  const body = JSON.stringify({ error: { message: 'private project and quota information', code: 'insufficient_quota', type: 'insufficient_quota' } })
  const error = providerError(429, true, body)
  delete error.responseHeaders!['retry-after-ms']
  const { request, model } = harness(avatar, error)
  const response = await request({ description: 'a sunflower' })
  expect(response.status).toBe(429)
  expect(response.headers.get('Retry-After')).toBeNull()
  expect(await response.json()).toEqual({
    error: 'The avatar service’s OpenAI quota has been exhausted. Ask your administrator to review API billing and usage limits.',
    code: 'quota_exhausted',
  })
  expect(model.doGenerateCalls).toHaveLength(1)
})

test('malformed quota metadata stays safe and does not fabricate a reset time', async () => {
  const { request, model } = harness(avatar, providerError(429, true, '{broken'))
  const response = await request({ description: 'a sunflower' })
  expect(await response.json()).toMatchObject({ code: 'rate_limited' })
  expect(response.headers.get('Retry-After')).toBe('1')
  expect(model.doGenerateCalls).toHaveLength(1)
})

test('avatar generation retains the output budget without Google-specific options', async () => {
  const { model: success } = harness()
  const model = new MockLanguageModelV4({ provider: 'openai.responses', modelId: 'gpt-test', doGenerate: (options) => success.doGenerate(options) })
  expect(await generateAvatarPreview('a game console', model)).toEqual(avatar)
  expect(model.doGenerateCalls[0].providerOptions?.google).toBeUndefined()
  expect(model.doGenerateCalls[0].maxOutputTokens).toBe(4096)
})

test('a model that spends its output budget without a design reports an empty response', async () => {
  const { model: success } = harness()
  const model = new MockLanguageModelV4({ doGenerate: async (options) => ({
    ...await success.doGenerate(options), content: [], finishReason: { unified: 'length', raw: 'MAX_TOKENS' },
  }) })
  await expect(generateAvatarPreview('a game console', model)).rejects.toMatchObject({
    status: 502, message: 'The avatar service returned no design. Please try again.',
  })
})
