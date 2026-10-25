import { HTTPException } from 'hono/http-exception'

export const MAX_OFFICE_BYTES = 10 * 1024 * 1024
export type OfficeKind = 'DOCUMENT' | 'SPREADSHEET'

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HTTPException(400, { message: 'Invalid editor snapshot.' })
  return value as Record<string, unknown>
}

// Preserve all SDK fields (styles, drawings and plugin resources included), but
// reject malformed roots and excessive structures before storing or converting.
export function validateOfficeContent(kind: OfficeKind, content: unknown) {
  const input = record(content)
  if (input.format !== 'univer' || input.kind !== kind) throw new HTTPException(400, { message: 'The editor snapshot has the wrong document type.' })
  const snapshot = record(input.snapshot)
  if (typeof snapshot.id !== 'string' || !snapshot.id || snapshot.id.length > 200) throw new HTTPException(400, { message: 'Invalid editor document ID.' })
  const pending = [{ value: input.snapshot, depth: 0 }]
  let count = 0
  while (pending.length) {
    const { value, depth } = pending.pop()!
    if (++count > 500_000 || depth > 80) throw new HTTPException(400, { message: 'The editor snapshot is too complex.' })
    if (value && typeof value === 'object') {
      for (const [key, item] of Object.entries(value)) {
        if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new HTTPException(400, { message: 'Invalid editor snapshot property.' })
        pending.push({ value: item, depth: depth + 1 })
      }
    }
  }
  if (kind === 'DOCUMENT') {
    const body = record(snapshot.body)
    if (typeof body.dataStream !== 'string' || !body.dataStream.endsWith('\r\n')) throw new HTTPException(400, { message: 'Invalid document text stream.' })
    record(snapshot.documentStyle)
  } else {
    const sheets = record(snapshot.sheets)
    const order = snapshot.sheetOrder
    if (typeof snapshot.name !== 'string' || !Array.isArray(order) || order.length < 1 || order.length > 100 ||
      order.length !== Object.keys(sheets).length || new Set(order).size !== order.length) {
      throw new HTTPException(400, { message: 'Provide a workbook with 1–100 unique sheets.' })
    }
    for (const id of order) {
      if (typeof id !== 'string' || !Object.hasOwn(sheets, id)) throw new HTTPException(400, { message: 'Invalid workbook sheet order.' })
      const sheet = record(sheets[id])
      if (sheet.id !== id || typeof sheet.name !== 'string' || !sheet.name.trim()) throw new HTTPException(400, { message: 'Invalid worksheet.' })
      for (const [field, max] of [['rowCount', 1_048_576], ['columnCount', 16_384]] as const) {
        const value = sheet[field]
        if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > max) throw new HTTPException(400, { message: 'Invalid worksheet dimensions.' })
      }
      const cells = record(sheet.cellData ?? {})
      for (const [row, values] of Object.entries(cells)) {
        if (!/^\d+$/.test(row) || Number(row) >= Number(sheet.rowCount)) throw new HTTPException(400, { message: 'Invalid worksheet row.' })
        for (const [column, cell] of Object.entries(record(values))) {
          if (!/^\d+$/.test(column) || Number(column) >= Number(sheet.columnCount)) throw new HTTPException(400, { message: 'Invalid worksheet column.' })
          // Empty entries can be null after clearing a range.
          if (cell !== null) record(cell)
        }
      }
    }
  }
  const result = { format: 'univer' as const, kind, snapshot }
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > MAX_OFFICE_BYTES) throw new HTTPException(413, { message: 'Keep document versions within 10 MB.' })
  return result
}
