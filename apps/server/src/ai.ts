import { createGoogle } from '@ai-sdk/google'
import { isStepCount, ToolLoopAgent, type LanguageModel } from 'ai'
import { HTTPException } from 'hono/http-exception'
import type { Bindings } from './env'

type AgentProfile = { id: string; name: string; role: string; rules: string[] }
type ChatMessage = { role: 'user' | 'assistant'; content: string }

// Resolve per request: Cloudflare supplies secrets through bindings, not process.env.
export function createAgentModel(env: Bindings): LanguageModel {
  const apiKey = env.GOOGLE_GENERATIVE_AI_API_KEY?.trim()
  const model = env.AI_MODEL?.trim()
  if (!apiKey || !model) {
    throw new HTTPException(503, { message: 'Agent AI is not configured.' })
  }
  if (!/^gemini-[a-zA-Z0-9._-]+$/.test(model)) {
    throw new HTTPException(503, { message: 'Agent AI model configuration is invalid.' })
  }
  return createGoogle({ apiKey })(model)
}

// The same agent supports generate() and stream() for future backend workflows.
export function createLLMAgent(profile: AgentProfile, model: LanguageModel) {
  return new ToolLoopAgent({
    id: profile.id,
    model,
    instructions: [
      `You are ${profile.name}, an assistant in Nautilus.`,
      `Your purpose: ${profile.role}`,
      ...profile.rules.map((rule) => `Rule: ${rule}`),
    ].join('\n'),
    stopWhen: isStepCount(5),
    maxOutputTokens: 4096,
    timeout: 60_000,
    maxRetries: 1,
    // Override the SDK's default logger, which can include provider details.
    onError: () => { console.error('Agent generation failed', { agentId: profile.id }) },
  })
}

export function parseAgentChat(value: unknown): { messages: ChatMessage[]; stream: boolean } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HTTPException(400, { message: 'Enter a valid agent chat request.' })
  }
  const input = value as Record<string, unknown>
  if (input.stream !== undefined && typeof input.stream !== 'boolean') {
    throw new HTTPException(400, { message: 'stream must be a boolean.' })
  }
  if (!Array.isArray(input.messages) || input.messages.length < 1 || input.messages.length > 50) {
    throw new HTTPException(400, { message: 'Provide 1–50 chat messages.' })
  }
  let totalLength = 0
  const messages = input.messages.map((message): ChatMessage => {
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      throw new HTTPException(400, { message: 'Enter a valid chat message.' })
    }
    const { role, content } = message as Record<string, unknown>
    if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string' || !content.trim()) {
      throw new HTTPException(400, { message: 'Messages must contain user or assistant text.' })
    }
    totalLength += content.length
    return { role, content }
  })
  if (totalLength > 32_000) throw new HTTPException(400, { message: 'Keep chat history within 32,000 characters.' })
  if (messages.at(-1)?.role !== 'user') throw new HTTPException(400, { message: 'End the chat history with a user message.' })
  // Strip all other fields: callers cannot override models, instructions, or tools.
  return { messages, stream: input.stream === true }
}
