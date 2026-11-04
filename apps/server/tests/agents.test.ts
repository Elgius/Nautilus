import { expect, test } from 'bun:test'
import { agentProfileData, parseAgentProfile } from '../src/agents'
import type { AvatarDesign } from '../../../shared/avatar-design'
import { Prisma } from '../src/generated/prisma/browser'

const profile = { name: ' Scout ', role: ' Research ', color: 'blue', avatarIcon: 'compass', rules: [' Ask first. ', '', 'Cite sources.'] }

test('normalizes profile fields while preserving rule order', () => {
  expect(parseAgentProfile({ ...profile, id: 'injected', organizationId: 'other', status: 'Working' })).toEqual({
    name: 'Scout', nameKey: 'scout', role: 'Research', color: 'blue', avatarIcon: 'compass',
    rules: ['Ask first.', 'Cite sources.'], avatarUrl: null, avatarDesign: null,
  })
})

test('custom avatars retain only validated geometry and can be replaced with presets', () => {
  const avatarDesign: AvatarDesign = { bodyPath: 'M10 10 L90 10 L50 90 Z', color: '#ffb500', eyes: [{ cx: 38, cy: 40, rx: 5, ry: 7 }, { cx: 64, cy: 40, rx: 5, ry: 7 }] }
  const parsed = parseAgentProfile({ ...profile, avatarDesign: { ...avatarDesign, onload: 'evil' } })
  expect(parsed.avatarDesign).toEqual({ ...avatarDesign, bodyPath: 'M 10 10 L 90 10 L 50 90 Z' })
  expect(agentProfileData(parsed).avatarDesign).toEqual(parsed.avatarDesign!)
  expect(agentProfileData(parseAgentProfile({ ...parsed, avatarDesign: null })).avatarDesign).toBe(Prisma.DbNull)
  for (const invalid of [{ ...avatarDesign, bodyPath: '<svg onload="alert(1)">' }, { ...avatarDesign, eyes: [] }, { ...avatarDesign, color: 'url(evil)' }]) {
    expect(() => parseAgentProfile({ ...profile, avatarDesign: invalid })).toThrow('Choose a valid custom avatar.')
  }
  expect(() => parseAgentProfile({ ...profile, avatarDesign, avatarUrl: 'data:image/png;base64,AAAA' })).toThrow('Choose one avatar')
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
