import { HTTPException } from 'hono/http-exception'
import { validateOfficeContent, type OfficeKind } from '../../../server/src/office-content'

export const MAX_EDIT_OPERATIONS = 100
export const MAX_RANGE_CELLS = 10_000

export function requireEdit(condition: unknown, message: string): asserts condition {
  if (!condition) throw new HTTPException(422, { message })
}

export function integer(value: unknown, min: number, max: number, label: string): asserts value is number {
  requireEdit(typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max, `Invalid ${label}.`)
}

export function editText(value: unknown, label = 'text'): asserts value is string {
  requireEdit(typeof value === 'string' && value.length <= 500_000, `Invalid ${label}.`)
}

export function patch(value: unknown): asserts value is Record<string, unknown> {
  requireEdit(!!value && typeof value === 'object' && !Array.isArray(value), 'Provide a style patch.')
  // Reject prototype keys, non-JSON values and unbounded patches before handing data to the SDK.
  const visit = (item: unknown, depth: number) => {
    requireEdit(depth <= 10, 'Style patch is too complex.')
    if (typeof item === 'number') requireEdit(Number.isFinite(item), 'Invalid style number.')
    else if (item && typeof item === 'object') {
      for (const [key, entry] of Object.entries(item)) {
        requireEdit(!['__proto__', 'prototype', 'constructor'].includes(key), 'Invalid style property.')
        visit(entry, depth + 1)
      }
    } else requireEdit(item === null || ['string', 'boolean'].includes(typeof item), 'Invalid style value.')
  }
  requireEdit(JSON.stringify(value).length <= 10_000, 'Style patch is too large.')
  visit(value, 0)
}

export function batch(value: unknown): asserts value is { type: string }[] {
  requireEdit(Array.isArray(value) && value.length > 0 && value.length <= MAX_EDIT_OPERATIONS, 'Provide 1–100 edits.')
  for (const operation of value) requireEdit(operation && typeof operation === 'object' && !Array.isArray(operation) && typeof operation.type === 'string', 'Invalid edit operation.')
}

export function contentSnapshot(kind: OfficeKind, content: unknown) {
  return validateOfficeContent(kind, content).snapshot
}
