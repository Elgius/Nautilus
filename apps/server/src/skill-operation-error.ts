import { HTTPException } from 'hono/http-exception'

export type OperationStage = 'authorization' | 'validation' | 'review' | 'office' | 'persistence'
export type OperationCode = 'ACCESS_DENIED' | 'INVALID_EDIT' | 'VERSION_CONFLICT' | 'REVIEW_REJECTED' | 'REVIEW_UNAVAILABLE' | 'OFFICE_UNAVAILABLE' | 'OFFICE_REJECTED' | 'PERSISTENCE_FAILED' | 'OPERATION_FAILED' | 'EDIT_ALREADY_REJECTED'

/** Only fixed codes/stages are logged; public messages never include raw provider errors. */
export class SkillOperationError extends HTTPException {
  constructor(readonly code: OperationCode, readonly stage: OperationStage, message: string, readonly retryable = false, status: 403 | 409 | 422 | 502 | 503 = 422) {
    super(status, { message: `[${code}] ${message}` })
  }
}
