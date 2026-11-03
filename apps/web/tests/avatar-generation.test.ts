import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AvatarGenerationError, generateAvatarPreview } from '../lib/avatar-generation'

test('preserves quota exhaustion and retry timing returned by the backend', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () => new Response(JSON.stringify({
    error: 'Daily quota reached.', code: 'quota_exhausted', retryAfterSeconds: 71886,
  }), { status: 429 })) as typeof originalFetch
  try {
    await assert.rejects(generateAvatarPreview('org-1', 'a sunflower', new AbortController().signal), (error: unknown) => {
      assert.ok(error instanceof AvatarGenerationError)
      assert.equal(error.quotaExhausted, true)
      assert.equal(error.retryAfterSeconds, 71886)
      assert.equal(error.message, 'Daily quota reached.')
      return true
    })
  } finally { globalThis.fetch = originalFetch }
})

test('does not apply cooldown metadata from invalid values or unrelated HTTP errors', async () => {
  for (const [status, retryAfterSeconds] of [[429, -5], [429, 99999999], [503, 100]] as const) {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => new Response(JSON.stringify({
      error: 'Unavailable.', code: 'quota_exhausted', retryAfterSeconds,
    }), { status })) as typeof originalFetch
    try {
      await assert.rejects(generateAvatarPreview('org-1', 'a sunflower', new AbortController().signal), (error: unknown) => {
        assert.ok(error instanceof AvatarGenerationError)
        assert.equal(error.retryAfterSeconds, undefined)
        return true
      })
    } finally { globalThis.fetch = originalFetch }
  }
})
