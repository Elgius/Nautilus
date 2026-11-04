// Match a standalone mention, leaving addresses such as person@example.com alone.
export function agentMention(text: string) {
  const match = /(^|\s)@/.exec(text)
  if (!match) return null
  const start = match.index + match[1].length
  return { start, query: /^[^\s@]*/.exec(text.slice(start + 1))![0] }
}

export function selectAgentMention(text: string, name: string) {
  const mention = agentMention(text)
  if (!mention) return { roomDraft: text, instruction: '' }
  let instruction = text.slice(mention.start + 1).trimStart()
  const lower = instruction.toLocaleLowerCase(), agent = name.toLocaleLowerCase()
  if (lower.startsWith(agent) && (!instruction[name.length] || /\s/.test(instruction[name.length]))) {
    instruction = instruction.slice(name.length).trimStart()
  } else if (mention.query && agent.startsWith(mention.query.toLocaleLowerCase())) {
    instruction = instruction.slice(mention.query.length).trimStart()
  }
  return { roomDraft: text.slice(0, mention.start).trimEnd(), instruction }
}
