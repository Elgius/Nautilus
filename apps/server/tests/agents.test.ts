import { expect, test } from 'bun:test'
import { parseAgentProfile } from '../src/agents'

const profile = { name: ' Scout ', role: ' Research ', color: 'blue', avatarIcon: 'compass', rules: [' Ask first. ', '', 'Cite sources.'] }

test('normalizes profile fields while preserving rule order', () => {
  expect(parseAgentProfile({ ...profile, id: 'injected', organizationId: 'other', status: 'Working' })).toEqual({
    name: 'Scout', nameKey: 'scout', role: 'Research', color: 'blue', avatarIcon: 'compass',
    rules: ['Ask first.', 'Cite sources.'], avatarUrl: null,
  })
})

test('rejects malformed profiles and limits rules and uploaded avatars', () => {
  for (const invalid of [null, [], { ...profile, name: ' ' }, { ...profile, name: 'a'.repeat(31) },
    { ...profile, role: '' }, { ...profile, color: 'unknown' }, { ...profile, avatarIcon: 'unknown' },
    { ...profile, rules: 'text' }, { ...profile, rules: [5] }, { ...profile, rules: ['a'.repeat(6001)] },
    { ...profile, rules: Array(101).fill('a') }, { ...profile, avatarUrl: 'javascript:alert(1)' },
    { ...profile, avatarUrl: 'data:image/svg+xml;base64,AAAA' },
    { ...profile, avatarUrl: `data:image/png;base64,${'A'.repeat(2_796_204)}` },
  ]) expect(() => parseAgentProfile(invalid)).toThrow()
})

test('accepts every creation avatar combination and preserves its identity on edits', () => {
  for (const color of ['brown', 'red', 'orange', 'amber', 'green', 'teal', 'blue', 'violet', 'pink', 'gray'] as const) {
    for (const avatarIcon of ['circle', 'oval', 'square', 'pill', 'triangle', 'hexagon', 'cloud', 'drop'] as const) {
      const created = parseAgentProfile({ ...profile, name: 'New agent', role: 'General assistant', color, avatarIcon, rules: [] })
      expect(created.color).toBe(color)
      expect(created.avatarIcon).toBe(avatarIcon)
      expect(parseAgentProfile({ ...created, rules: ['Be concise.'] })).toMatchObject({ color, avatarIcon, rules: ['Be concise.'] })
    }
  }
})
