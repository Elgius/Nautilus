import { HTTPException } from 'hono/http-exception'
import type { AgentErrorCode, AgentErrorStage, ReviewRejectionReason } from '../../../shared/agent-errors'

export type OperationStage = AgentErrorStage
export type OperationCode = AgentErrorCode

/** Only fixed codes/stages are logged; public messages never include raw provider errors. */
export class SkillOperationError extends HTTPException {
  constructor(readonly code: OperationCode, readonly stage: OperationStage, message: string, readonly retryable = false, status: 403 | 409 | 422 | 502 | 503 = 422, readonly reason?: ReviewRejectionReason) {
    super(status, { message: `[${code}] ${message}` })
    this.name = 'SkillOperationError'
  }
}

/** Preserve a cause for server diagnostics without exposing provider text to clients. */
export class AgentRunError extends Error {
  constructor(readonly code: AgentErrorCode, options?: ErrorOptions) { super(code, options); this.name = 'AgentRunError' }
}

export function errorDiagnostics(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { errorType: typeof error }
  const typed = error as Error & { statusCode?: unknown; code?: unknown }
  // Do not log messages, response bodies, headers, tool inputs or provider URLs.
  return { errorType: error.name.replace(/[^\w.-]/g, '').slice(0, 80),
    ...(typeof typed.statusCode === 'number' ? { providerStatus: typed.statusCode } : {}),
    ...(typeof typed.code === 'string' && /^[A-Z_0-9]{1,60}$/.test(typed.code) ? { causeCode: typed.code } : {}),
    ...(error.cause instanceof Error ? { causeType: error.cause.name.replace(/[^\w.-]/g, '').slice(0, 80) } : {}),
  }
}
