import { expect, test } from 'bun:test'
import { createDatabase } from '../scripts/db'
import { agentProfileData, agentSelect, parseAgentProfile } from '../src/agents'
import { parseAgentCreation, saveCreatedAgent } from '../src/agent-creator'
import { parseAvatarDesign } from '../../../shared/avatar-design'
import type { AvatarDesign } from '../../../shared/avatar-design'
import type { Database } from '../src/db'

// Opt in with a dedicated Neon test branch; all fixtures belong to a temporary org.
test.skipIf(!process.env.TEST_AVATAR_DATABASE_URL)('generated avatar survives create, reload, profile edits, and preset reset in Neon', async () => {
  const db = createDatabase(process.env.TEST_AVATAR_DATABASE_URL!)
  const organizationId = crypto.randomUUID()
  const avatarDesign: AvatarDesign = { bodyPath: 'M 10 10 L 90 10 L 50 90 Z', color: '#ffb500', eyes: [{ cx: 38, cy: 40, rx: 5, ry: 7 }, { cx: 64, cy: 40, rx: 5, ry: 7 }] }
  try {
    await db.organization.create({ data: { id: organizationId, name: 'Avatar persistence test', slug: `avatar-${organizationId}` } })
    const input = parseAgentCreation({ name: 'Pencil', color: 'amber', avatarIcon: 'triangle', avatarDesign, description: 'Help with writing.' })
    const created = await saveCreatedAgent(db as unknown as Database, organizationId, input, { purpose: 'Writing', rules: ['Be concise.'] })
    const where = { id: created.id, organizationId }
    const loaded = await db.agent.findUniqueOrThrow({ where, select: agentSelect })
    expect(loaded.avatarDesign).toEqual(avatarDesign)
    const agent = parseAgentProfile(loaded)
    expect(parseAvatarDesign(agent.avatarDesign)).toEqual(avatarDesign)
    await db.agent.update({ where, data: agentProfileData(parseAgentProfile({ ...agent, role: 'Draft and edit writing' })) })
    expect((await db.agent.findUniqueOrThrow({ where })).avatarDesign).toEqual(avatarDesign)
    await db.agent.update({ where, data: agentProfileData(parseAgentProfile({ ...agent, avatarDesign: null, avatarIcon: 'cloud' })) })
    const reset = await db.agent.findUniqueOrThrow({ where, select: agentSelect })
    expect(reset.avatarDesign).toBeNull()
    expect(reset.avatarIcon).toBe('cloud')
  } finally {
    await db.organization.deleteMany({ where: { id: organizationId } })
    await db.$disconnect()
  }
}, 30_000)
