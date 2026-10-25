import { HTTPException } from 'hono/http-exception'
import type { Bindings } from './env'

export function officeConfigured(env: Bindings) {
  return !!env.OFFICE_SERVICE_URL && (env.OFFICE_SERVICE_TOKEN?.length ?? 0) >= 32
}

export async function officeRequest(env: Bindings, path: string, body: BodyInit, json = false) {
  if (!officeConfigured(env)) throw new HTTPException(503, { message: 'Word and Excel import/export requires the Office conversion service.' })
  let response: Response
  try {
    response = await fetch(`${env.OFFICE_SERVICE_URL!.replace(/\/$/, '')}${path}`, {
      method: 'POST', body, redirect: 'manual', signal: AbortSignal.timeout(60_000),
      headers: { Authorization: `Bearer ${env.OFFICE_SERVICE_TOKEN}`, ...(json ? { 'Content-Type': 'application/json' } : {}) },
    })
  } catch (error) {
    console.error('Office service request failed:', error instanceof Error ? error.message : 'Unknown network error')
    throw new HTTPException(502, { message: 'The Office conversion service could not be reached. Please try again.' })
  }
  if (!response.ok) {
    const result = await response.json().catch(() => null) as { error?: string } | null
    throw new HTTPException(response.status === 413 ? 413 : response.status === 422 || response.status === 400 ? 422 : 502,
      { message: result?.error ?? 'Could not convert this Office file.' })
  }
  return response
}
