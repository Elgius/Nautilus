import { z } from 'zod'

export const hubOptions = z.strictObject({
  conversationId: z.uuid().optional(),
  knowledge: z.array(z.enum(['PERSONAL', 'ORGANIZATION'])).max(2).refine((scopes) => new Set(scopes).size === scopes.length).default(['ORGANIZATION']),
  reasoning: z.enum(['low', 'medium', 'high']).default('medium'),
})
export const runInput = hubOptions.extend({ requestId: z.uuid(), agentId: z.string().min(1).max(100), instruction: z.string().trim().min(1).max(20_000) })
