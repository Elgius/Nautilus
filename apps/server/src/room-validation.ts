import { HTTPException } from 'hono/http-exception'
import { validateOfficeContent } from './office-content'

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HTTPException(400, { message: 'Provide a valid request body.' })
  return value as Record<string, unknown>
}
export function text(value: unknown, label: string, max: number, empty = false) {
  if (typeof value !== 'string' || (!empty && !value.trim()) || value.trim().length > max) {
    throw new HTTPException(400, { message: `${label} must be ${empty ? '0' : '1'}–${max} characters.` })
  }
  return value.trim()
}
export function ids(value: unknown, max = 100): string[] {
  if (!Array.isArray(value) || value.length > max || value.some((id) => typeof id !== 'string' || !id || id.length > 100)) {
    throw new HTTPException(400, { message: 'Provide a valid list of IDs.' })
  }
  return [...new Set(value as string[])]
}
export function parseRoom(value: unknown) {
  const input = object(value)
  const status = (['READY', 'WORKING', 'NEEDS_REVIEW'] as const).find((item) => item === (input.status ?? 'READY'))
  const color = ['violet', 'orange', 'blue', 'green'].find((item) => item === (input.color ?? 'green'))
  if (!status || !color) throw new HTTPException(400, { message: 'Choose a valid room status and color.' })
  return { name: text(input.name, 'Room name', 70), description: text(input.description ?? '', 'Description', 600, true),
    category: text(input.category ?? 'General', 'Team', 70), status, color, agentIds: ids(input.agentIds ?? []) }
}

export function parseContent(kind: 'DOCUMENT' | 'SPREADSHEET', content: unknown): string {
  if (content && typeof content === 'object' && 'format' in content && content.format === 'univer') {
    return JSON.stringify(validateOfficeContent(kind, content))
  }
  if (kind === 'DOCUMENT') {
    if (typeof content !== 'string' || content.length > 500_000) throw new HTTPException(400, { message: 'Document content must be text, up to 500,000 characters.' })
    return JSON.stringify({ format: 'markdown', text: content })
  }
  const input = object(content)
  if (!Array.isArray(input.sheets) || !input.sheets.length || input.sheets.length > 20) throw new HTTPException(400, { message: 'Provide 1–20 spreadsheet sheets.' })
  const sheetIds = new Set<number>()
  for (const raw of input.sheets) {
    const sheet = object(raw)
    if (typeof sheet.id !== 'number' || !Number.isSafeInteger(sheet.id) || sheetIds.has(sheet.id)) throw new HTTPException(400, { message: 'Spreadsheet sheet IDs must be unique integers.' })
    sheetIds.add(sheet.id)
    text(sheet.name, 'Sheet name', 70)
    if (!Array.isArray(sheet.cells) || !sheet.cells.length || sheet.cells.length > 1000 || sheet.cells.some((row) =>
      !Array.isArray(row) || row.length !== 8 || row.some((cell) => typeof cell !== 'string' || cell.length > 10_000))) {
      throw new HTTPException(400, { message: 'Invalid spreadsheet cells (up to 1,000 rows and 8 columns).' })
    }
  }
  const rawStyles = object(input.styles ?? {})
  if (Object.keys(rawStyles).length > 20_000) throw new HTTPException(400, { message: 'Too many spreadsheet cell styles.' })
  const styles: Record<string, { bold: boolean; italic: boolean }> = {}
  for (const [key, raw] of Object.entries(rawStyles)) {
    if (!/^\d+:\d+:\d+$/.test(key)) throw new HTTPException(400, { message: 'Invalid spreadsheet cell style.' })
    const style = object(raw)
    if ((style.bold !== undefined && typeof style.bold !== 'boolean') || (style.italic !== undefined && typeof style.italic !== 'boolean')) {
      throw new HTTPException(400, { message: 'Invalid spreadsheet cell style.' })
    }
    styles[key] = { bold: style.bold === true, italic: style.italic === true }
  }
  return JSON.stringify({ format: 'spreadsheet', sheets: input.sheets.map((raw) => {
    const sheet = object(raw)
    return { id: sheet.id, name: text(sheet.name, 'Sheet name', 70), cells: sheet.cells }
  }), styles })
}
