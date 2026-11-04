import { createOpenAI, type OpenAILanguageModelResponsesOptions } from '@ai-sdk/openai'
import { defaultSettingsMiddleware, wrapLanguageModel, type LanguageModel } from 'ai'
import { HTTPException } from 'hono/http-exception'
import type { Bindings } from './env'

// Compatibility export for the existing direct-chat endpoint.
export { createAgentInterface as createLLMAgent } from './agent_interface'
type ChatMessage = { role: 'user' | 'assistant'; content: string }

// Resolve per request: Cloudflare supplies secrets through bindings, not process.env.
export function createAgentModel(env: Bindings): LanguageModel {
  const apiKey = env.OPENAI_API_KEY?.trim()
  const model = env.LLM_MODEL?.trim()
  if (!apiKey || !model) {
    throw new HTTPException(503, { message: 'Agent AI is not configured.' })
  }
  if (!/^(?:gpt-[a-zA-Z0-9._-]+|o\d[a-zA-Z0-9._-]*)$/.test(model)) {
    throw new HTTPException(503, { message: 'Agent AI model configuration is invalid.' })
  }
  // Keep all workflows stateless at the provider; Nautilus supplies their history.
  const options: OpenAILanguageModelResponsesOptions = {
    store: false,
    reasoningSummary: null,
  }
  return wrapLanguageModel({
    model: createOpenAI({ apiKey }).responses(model),
    middleware: defaultSettingsMiddleware({ settings: { providerOptions: { openai: options } } }),
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
