import { afterEach, expect, spyOn, test } from 'bun:test'
import { officeConfigured, officeRequest } from '../src/office-service'
import type { Bindings } from '../src/env'

const env = { OFFICE_SERVICE_URL: 'http://127.0.0.1:8790/', OFFICE_SERVICE_TOKEN: 'private-test-token-at-least-32-characters' } as Bindings
let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, 'fetch'>> | undefined
afterEach(() => { fetchSpy?.mockRestore() })

test('converter requests preserve Worker-compatible redirect handling and private authentication', async () => {
  fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(new Response('file'))
  const response = await officeRequest(env, '/export', '{}', true)
  expect(await response.text()).toBe('file')
  expect(fetchSpy).toHaveBeenCalledWith('http://127.0.0.1:8790/export', expect.objectContaining({
    method: 'POST', redirect: 'manual', headers: { Authorization: `Bearer ${env.OFFICE_SERVICE_TOKEN}`, 'Content-Type': 'application/json' },
  }))
})

test('redirects and failed conversions do not return successful downloads', async () => {
  fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 302, headers: { Location: 'https://untrusted.example' } }))
  await expect(officeRequest(env, '/export', '{}', true)).rejects.toThrow('Could not convert this Office file.')
  fetchSpy.mockResolvedValue(new Response(JSON.stringify({ error: 'Invalid Office file.' }), { status: 422 }))
  await expect(officeRequest(env, '/export', '{}', true)).rejects.toThrow('Invalid Office file.')
})

test('conversion is unavailable until both server settings are configured', async () => {
  expect(officeConfigured({} as Bindings)).toBe(false)
  expect(officeConfigured({ ...env, OFFICE_SERVICE_TOKEN: 'short' })).toBe(false)
  expect(officeConfigured(env)).toBe(true)
  await expect(officeRequest({} as Bindings, '/export', '{}')).rejects.toThrow('requires the Office conversion service')
})
