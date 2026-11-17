import { tool } from 'ai'
import { z } from 'zod'
import type { AgentSkill } from './agent_interface/skills'
import type { AgentRunContext } from './private-room-agents'

export const agentQuestionInput = z.strictObject({
  question: z.string().trim().min(1).max(2000),
  options: z.array(z.string().trim().min(1).max(200)).min(2).max(5).optional(),
})

/** Dedicated bridge from an agent tool to the persisted private input box. */
export async function requestAgentInput(run: AgentRunContext, input: z.infer<typeof agentQuestionInput>, signal: AbortSignal) {
  signal.throwIfAborted()
  if (!run.askUser) throw new Error('Interactive questions are unavailable for this request.')
  await run.askUser(agentQuestionInput.parse(input))
  return { status: 'awaiting_user_input' as const }
}

export function createAgentQuestionSkill(run: AgentRunContext, signal: AbortSignal): AgentSkill {
  return {
    id: 'user-input',
    instructions: 'When you need a specific answer from the user to proceed, call askUser to display a private input box. Ask one focused question and optionally provide 2–5 short suggested answers; free text is always allowed. First use available read tools to discover room documents and resolve simple facts. Do not claim missing access without checking. Call askUser alone, never alongside edits or other tools. This ends the current run and releases the room; a user answer starts a new run with the conversation history. Do not claim the requested work is finished while awaiting input.',
    tools: {
      askUser: tool({ description: 'Show a private input box with a specific clarification question and optional suggested answers. Ends this run until the user answers.', inputSchema: agentQuestionInput,
        execute: (input, { abortSignal }) => requestAgentInput(run, input, abortSignal ? AbortSignal.any([signal, abortSignal]) : signal) }),
    },
  }
}
