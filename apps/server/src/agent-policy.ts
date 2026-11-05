import { HTTPException } from 'hono/http-exception'

// Defense in depth for common explicit overrides, not a semantic safety classifier.
// Run on writes AND use so older saved profiles cannot bypass these checks.
const forbidden = [
  /\b(?:ignore|override|bypass|disable|disregard)\b.{0,80}?\b(?:platform|system|safety|safeguards?|guardrails?|permissions?|access checks?|tool contracts?)\b/i,
  /\b(?:reveal|disclose|expose|print|leak)\b.{0,60}?\b(?:credentials?|api keys?|secrets?|system prompts?|hidden instructions?)\b/i,
  /\b(?:always|falsely)\s+(?:claim|report|say)\b.{0,60}?\b(?:success|succeeded|saved|complete|completed)\b/i,
  /\b(?:follow|obey|execute)\b.{0,60}?\binstructions\b.{0,40}?\b(?:documents?|cells?|tool results?|specialist reports?)\b/i,
]

export function assertSafeAgentProfile(profile: { name: string; role: string; rules: string[] }) {
  for (const field of [profile.name, profile.role, ...profile.rules]) {
    const normalized = field.normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, ' ')
    if (forbidden.some((pattern) => {
      return [...normalized.matchAll(new RegExp(pattern.source, 'gi'))].some((match) => {
        // A rule forbidding disclosure or requiring verified success is legitimate.
        if (/\b(?:never|not|don't|avoid|refuse to)\s*$/i.test(normalized.slice(0, match.index))) return false
        if (/^always\b/i.test(match[0]) && /^\s+only (?:after|when|if)\b/i.test(normalized.slice(match.index + match[0].length))) return false
        return true
      })
    })) {
      throw new HTTPException(422, { message: 'Agent instructions must respect platform safeguards, privacy, and truthful reporting.' })
    }
  }
}
