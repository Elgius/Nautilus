import { HTTPException } from 'hono/http-exception'
import type { Bindings } from './env'
import { SkillOperationError } from './skill-operation-error'

export function officeConfigured(env: Bindings) {
  return !!env.OFFICE_SERVICE_URL && (env.OFFICE_SERVICE_TOKEN?.length ?? 0) >= 32
}

export async function officeRequest(env: Bindings, path: string, body: BodyInit, json = false, signal?: AbortSignal) {
  if (!officeConfigured(env)) throw new SkillOperationError('OFFICE_UNAVAILABLE', 'office', 'Word and Excel editing/import/export requires the Office conversion service.', true, 503)
  signal?.throwIfAborted()
  let response: Response
  try {
    response = await fetch(`${env.OFFICE_SERVICE_URL!.replace(/\/$/, '')}${path}`, {
      method: 'POST', body, redirect: 'manual', signal: AbortSignal.any([AbortSignal.timeout(60_000), ...(signal ? [signal] : [])]),
      headers: { Authorization: `Bearer ${env.OFFICE_SERVICE_TOKEN}`, ...(json ? { 'Content-Type': 'application/json' } : {}) },
    })
  } catch {
    signal?.throwIfAborted()
    console.error('Office service request failed:', { errorCode: 'OFFICE_UNAVAILABLE', stage: 'office' })
    throw new SkillOperationError('OFFICE_UNAVAILABLE', 'office', 'The Office conversion service could not be reached. Please try again.', true, 502)
  }
  if (!response.ok) {
    const result = await response.json().catch(() => null) as { error?: string } | null
    if (path === '/edit') throw new SkillOperationError(response.status === 400 || response.status === 422 ? 'OFFICE_REJECTED' : 'OFFICE_UNAVAILABLE', 'office',
      response.status === 400 || response.status === 422 ? result?.error ?? 'The Office service rejected this edit.' : 'The Office service could not apply this edit. No successful edit result was returned.', response.status >= 500, response.status === 400 || response.status === 422 ? 422 : 502)
    throw new HTTPException(response.status === 413 ? 413 : response.status === 422 || response.status === 400 ? 422 : 502,
      { message: result?.error ?? 'Could not convert this Office file.' })
  }
  return response
}
