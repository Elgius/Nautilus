import { APICallError } from 'ai'
import { HTTPException } from 'hono/http-exception'

export class AvatarRateLimitError extends HTTPException {
  constructor(readonly quotaExhausted: boolean, readonly retryAfterSeconds?: number) {
    super(429, { message: quotaExhausted
      ? 'The avatar service’s OpenAI quota has been exhausted. Ask your administrator to review API billing and usage limits.'
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
  // Read only quota classification fields. Never return raw provider bodies,
  // which may contain account identifiers, credentials, or private request data.
  try {
    const details = JSON.parse(error.responseBody ?? '{}')?.error
    quotaExhausted = details?.code === 'insufficient_quota' || details?.type === 'insufficient_quota'
  } catch { /* Missing/malformed metadata still produces a safe rate-limit error. */ }
  return new AvatarRateLimitError(quotaExhausted, retryAfterSeconds)
}
