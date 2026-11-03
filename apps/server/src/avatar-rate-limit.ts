import { APICallError } from 'ai'
import { HTTPException } from 'hono/http-exception'

export class AvatarRateLimitError extends HTTPException {
  constructor(readonly quotaExhausted: boolean, readonly retryAfterSeconds?: number) {
    super(429, { message: quotaExhausted
      ? 'Gemini’s daily generation quota has been reached. Try again after it resets, or ask your administrator to review the API quota.'
      : 'Avatar generation is temporarily rate-limited. Please wait before trying again.',
    })
  }
}

export function avatarRateLimit(error: APICallError): AvatarRateLimitError {
  let quotaExhausted = false
  let retryAfterSeconds: number | undefined
  function useDelay(value: number) {
    if (Number.isFinite(value) && value >= 0 && value <= 7 * 86400) {
      retryAfterSeconds = Math.max(retryAfterSeconds ?? 0, Math.max(1, Math.ceil(value)))
    }
  }
  const header = error.responseHeaders?.['retry-after']
  if (header) useDelay(/^\d+(?:\.\d+)?$/.test(header) ? Number(header) : (Date.parse(header) - Date.now()) / 1000)
  const milliseconds = error.responseHeaders?.['retry-after-ms']
  if (milliseconds) useDelay(Number(milliseconds) / 1000)
  // Read only documented quota and retry fields. Never return raw provider bodies,
  // which may contain account identifiers, credentials, or private request data.
  try {
    const details = JSON.parse(error.responseBody ?? '{}')?.error?.details
    if (Array.isArray(details)) for (const detail of details) {
      if (detail?.['@type'] === 'type.googleapis.com/google.rpc.QuotaFailure' && Array.isArray(detail.violations)) {
        quotaExhausted ||= detail.violations.some((violation: { quotaId?: unknown; quotaValue?: unknown }) =>
          (typeof violation?.quotaId === 'string' && /PerDay/i.test(violation.quotaId)) || violation?.quotaValue === '0' || violation?.quotaValue === 0)
      }
      if (detail?.['@type'] === 'type.googleapis.com/google.rpc.RetryInfo' && typeof detail.retryDelay === 'string') {
        const delay = /^(\d+(?:\.\d+)?)s$/.exec(detail.retryDelay)
        if (delay) useDelay(Number(delay[1]))
      }
    }
  } catch { /* Missing/malformed metadata still produces a safe rate-limit error. */ }
  return new AvatarRateLimitError(quotaExhausted, retryAfterSeconds)
}
