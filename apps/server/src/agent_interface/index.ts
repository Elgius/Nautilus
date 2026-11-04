import { isStepCount, ToolLoopAgent, type LanguageModel, type ToolSet } from 'ai'
import type { AgentSkill } from './skills'
export { createOfficeSkills, type AgentSkill, type SkillBackend } from './skills'
export { createRoomSkillBackend } from './room-skills'

export type AgentProfile = { id: string; name: string; role: string; rules: string[] }

/** One runtime for agent/model communication and dispatch to registered skills. */
export function createAgentInterface(profile: AgentProfile, model: LanguageModel, skills: AgentSkill[] = [], options: { steps?: number; timeout?: number } = {}) {
  const tools: ToolSet = {}
  for (const skill of skills) for (const [name, definition] of Object.entries(skill.tools)) {
    if (Object.hasOwn(tools, name)) throw new Error(`Duplicate agent tool: ${name}`)
    tools[name] = definition
  }
  return new ToolLoopAgent({
    id: profile.id, model, tools,
    instructions: [
      `You are ${profile.name}, an assistant in Nautilus.`,
      `Your purpose: ${profile.role}`,
      ...profile.rules.map((rule) => `Rule: ${rule}`),
      'Use only the tools provided to you. Report a saved edit only after its tool succeeds. If a tool fails, explain the limitation without claiming success.',
      ...skills.map((skill) => `Skill ${skill.id}:\n${skill.instructions}`),
    ].join('\n'),
    toolCallConcurrency: 1,
    stopWhen: isStepCount(options.steps ?? 8), maxOutputTokens: 4096, timeout: options.timeout ?? 60_000, maxRetries: 1,
    onError: () => { console.error('Agent generation failed', { agentId: profile.id }) },
  })
}
