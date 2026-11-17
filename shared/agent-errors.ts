// Stable application codes. Model prose must never determine a run's error code.
export const agentErrorMessages = {
  RUN_TIMEOUT: 'The agent ran out of time.',
  RUN_CANCELLED: 'Cancelled.',
  RUN_INTERRUPTED: 'The agent was interrupted.',
  STEP_LIMIT_REACHED: 'The agent reached its work limit.',
  MODEL_REQUEST_FAILED: 'The AI service could not complete the request.',
  MODEL_STREAM_INTERRUPTED: 'The connection to the AI service ended unexpectedly.',
  MODEL_OUTPUT_LIMIT: 'The AI response reached its output limit.',
  EMPTY_RESPONSE: 'The agent finished without a reply.',
  RESPONSE_TOO_LARGE: 'The agent’s response exceeded the size limit.',
  DOCUMENT_NOT_FOUND: 'No saved document matches that name.',
  DOCUMENT_AMBIGUOUS: 'More than one saved document matches that name. Choose a document.',
  DOCUMENT_READ_REQUIRED: 'The document must be read again before this change can be saved.',
  ACCESS_DENIED: 'Access to this room or document has expired.',
  AGENT_ACCESS_DENIED: 'Choose an agent you created in this organization.',
  VERSION_CONFLICT: 'The document changed. Read its latest version before continuing.',
  INVALID_EDIT: 'The proposed change could not be applied.',
  REVIEW_CONTEXT_MISSING: 'The change needs document context before it can be reviewed.',
  REVIEW_CONTEXT_TOO_LARGE: 'The change is too large to review. Use a smaller batch.',
  REVIEW_REJECTED: 'The review could not verify this change against your request. This change was not saved.',
  REVIEW_UNAVAILABLE: 'The review service could not verify this change. Try again.',
  EDIT_ALREADY_REJECTED: 'This unchanged edit was already rejected.',
  DELEGATION_SELF_TARGET: 'An agent cannot delegate work to itself.',
  DELEGATION_LIMIT_REACHED: 'The specialist assignment limit was reached.',
  DELEGATION_INVALID_ASSIGNMENT: 'The specialist assignment needs a different agent or a clearer document scope.',
  OFFICE_UNAVAILABLE: 'The document editing service is unavailable. Try again.',
  OFFICE_REJECTED: 'The document editing service could not apply this change.',
  PERSISTENCE_FAILED: 'The save could not be confirmed. Check the latest document before retrying.',
  OPERATION_FAILED: 'The operation could not be completed.',
  INTERNAL_ERROR: 'The request could not be completed. Try again.',
  INVALID_REQUEST: 'Check the request and try again.',
} as const;
export type AgentErrorCode = keyof typeof agentErrorMessages;
export type AgentErrorStage = 'run' | 'model' | 'discovery' | 'authorization' | 'validation' | 'review' | 'delegation' | 'office' | 'persistence';
export type ReviewRejectionReason = 'scope_mismatch' | 'insufficient_context' | 'unsupported_facts' | 'destructive_change' | 'unsafe_content';
export const reviewReasonMessages: Record<ReviewRejectionReason, string> = {
  scope_mismatch: 'The review judged that the proposed change exceeded the requested scope.',
  insufficient_context: 'The review needed more context to verify the change.',
  unsupported_facts: 'The review could not verify factual additions.',
  destructive_change: 'The review judged that the change removed content beyond the requested scope.',
  unsafe_content: 'The proposed content did not pass review.',
};
export type AgentOperationIssue = { code: AgentErrorCode; stage: AgentErrorStage; retryable: boolean; toolName?: string; toolCallId?: string; reason?: ReviewRejectionReason };

export function agentRunErrorMessage(code: AgentErrorCode, savedBatches: number) {
  const saved = savedBatches ? ` ${savedBatches} edit ${savedBatches === 1 ? 'batch was' : 'batches were'} saved.` : '';
  const next = code === 'RUN_TIMEOUT' || code === 'STEP_LIMIT_REACHED'
    ? ' Continue to finish the remaining sections.'
    : savedBatches ? ' Review saved changes before continuing.' : '';
  return `${agentErrorMessages[code]}${saved}${next}`;
}
