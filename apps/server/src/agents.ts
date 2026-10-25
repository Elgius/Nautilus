import { HTTPException } from 'hono/http-exception'

const colors = ['violet', 'coral', 'blue', 'green'] as const
const icons = ['bot', 'sparkles', 'compass', 'code', 'book', 'chart'] as const

// Only profile fields are accepted; tenant, IDs, and runtime status are server-owned.
export function parseAgentProfile(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HTTPException(400, { message: 'Enter a valid agent profile.' })
  }
  const input = value as Record<string, unknown>
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  const role = typeof input.role === 'string' ? input.role.trim() : ''
  if (!name || name.length > 30) throw new HTTPException(400, { message: 'Agent names must be 1–30 characters.' })
  if (!role || role.length > 70) throw new HTTPException(400, { message: 'Enter a purpose of 1–70 characters.' })
  const color = colors.find((color) => color === input.color)
  const avatarIcon = icons.find((icon) => icon === input.avatarIcon)
  if (!color || !avatarIcon) throw new HTTPException(400, { message: 'Choose a valid avatar icon and color.' })
  if (!Array.isArray(input.rules) || input.rules.length > 100 || input.rules.some((rule) => typeof rule !== 'string')) {
    throw new HTTPException(400, { message: 'Provide up to 100 text rules.' })
  }
  const rules = (input.rules as string[]).map((rule) => rule.trim()).filter(Boolean)
  if (rules.join('\n').length > 6000) throw new HTTPException(400, { message: 'Keep all rules within 6,000 characters.' })
  const avatarUrl = input.avatarUrl ?? null
  if (avatarUrl !== null) {
    if (typeof avatarUrl !== 'string' || avatarUrl.length > 2_796_240) {
      throw new HTTPException(400, { message: 'Choose an avatar image up to 2 MB.' })
    }
    const image = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(avatarUrl)
    if (!image || image[2].length % 4 !== 0) throw new HTTPException(400, { message: 'Choose a PNG, JPEG, or WebP avatar.' })
    const bytes = image[2].length * 3 / 4 - (image[2].endsWith('==') ? 2 : image[2].endsWith('=') ? 1 : 0)
    if (bytes > 2 * 1024 * 1024) throw new HTTPException(400, { message: 'Choose an avatar image up to 2 MB.' })
  }
  return { name, nameKey: name.toLowerCase(), role, color, avatarIcon, avatarUrl, rules }
}

// Keep normalized uniqueness keys out of the public API.
export const agentSelect = {
  id: true, organizationId: true, name: true, role: true, color: true,
  avatarIcon: true, avatarUrl: true, rules: true, status: true,
  createdAt: true, updatedAt: true,
} as const
