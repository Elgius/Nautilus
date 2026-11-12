import { z } from 'zod'

export type Chunk = { locator: string; text: string }
const CHUNK_SIZE = 16_000
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
export function textChunks(text: string, locator: string): Chunk[] {
  const chunks: Chunk[] = []
  for (let start = 0; start < text.length; start += CHUNK_SIZE) {
    chunks.push({ locator: `${locator}; UTF-16 ${start}–${Math.min(start + CHUNK_SIZE, text.length)}`, text: text.slice(start, start + CHUNK_SIZE) })
  }
  return chunks
}
function columnName(column: number): string {
  let name = ''
  for (let n = column + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + (n - 1) % 26) + name
  return name
}

/** Extract saved text and cell values only, never resource blobs, comments, or chat. */
export function documentChunks(content: unknown): Chunk[] {
  const root = record(content), chunks: Chunk[] = []
  if (root.format === 'markdown' && typeof root.text === 'string') return textChunks(root.text, 'Document body')
  if (root.format === 'spreadsheet' && Array.isArray(root.sheets)) {
    for (const raw of root.sheets) {
      const sheet = record(raw)
      if (!Array.isArray(sheet.cells)) throw new Error('Invalid saved sheet.')
      const text = sheet.cells.flatMap((row: unknown, r: number) => Array.isArray(row) ? row.flatMap((v, c) => v === '' || v === null ? [] : [`${columnName(c)}${r + 1}: ${String(v)}`]) : []).join('\n')
      chunks.push(...textChunks(text, `Sheet ${String(sheet.name)} (${String(sheet.id)}); cells listed by address`))
    }
    return chunks
  }
  if (root.format !== 'univer') throw new Error('Unsupported saved document. Open and save it in the editor.')
  const snapshot = record(root.snapshot)
  if (root.kind === 'DOCUMENT') {
    const body = record(snapshot.body)
    if (typeof body.dataStream !== 'string') throw new Error('Invalid saved document body.')
    chunks.push(...textChunks(body.dataStream, 'Document body'))
    for (const kind of ['headers', 'footers']) for (const [id, value] of Object.entries(record(snapshot[kind]))) {
      const body = record(record(value).body)
      if (typeof body.dataStream === 'string') chunks.push(...textChunks(body.dataStream, `${kind} ${id}`))
    }
  } else if (root.kind === 'SPREADSHEET') {
    if (!Array.isArray(snapshot.sheetOrder)) throw new Error('Invalid saved workbook.')
    const sheets = record(snapshot.sheets)
    for (const id of snapshot.sheetOrder) {
      const sheet = record(sheets[String(id)]), lines: string[] = []
      for (const [row, values] of Object.entries(record(sheet.cellData)).sort(([a], [b]) => Number(a) - Number(b))) {
        for (const [column, raw] of Object.entries(record(values)).sort(([a], [b]) => Number(a) - Number(b))) {
          const cell = record(raw), rich = record(record(cell.p).body).dataStream
          const value = typeof rich === 'string' ? rich : cell.v
          if (value === null || value === undefined || value === '') {
            if (typeof cell.f === 'string') lines.push(`${columnName(Number(column))}${Number(row) + 1}: formula ${cell.f} (no saved calculated value)`)
            continue
          }
          lines.push(`${columnName(Number(column))}${Number(row) + 1}: ${String(value)}${typeof cell.f === 'string' ? ` [formula ${cell.f}; saved value, not recalculated]` : ''}`)
        }
      }
      chunks.push(...textChunks(lines.join('\n'), `Sheet ${String(sheet.name)} (${String(id)}); cells listed by address`))
    }
  } else throw new Error('Unsupported saved document type.')
  return chunks
}

export const findingsSchema = z.object({ findings: z.array(z.object({
  category: z.enum(['Decision', 'Progress', 'Blocker', 'Reference', 'Conflict']),
  title: z.string().min(1).max(160),
  body: z.string().min(1).max(1800),
  evidence: z.string().min(1).max(500),
})).max(8) })
export type Finding = z.infer<typeof findingsSchema>['findings'][number] & { locator: string }
export function validateFindings(value: unknown, chunk: Chunk): Finding[] {
  return findingsSchema.parse(value).findings.map((finding) => {
    if (!chunk.text.includes(finding.evidence)) throw new Error('Finding has no matching source evidence.')
    return { ...finding, locator: chunk.locator }
  })
}
export function reportBody(findings: Finding[]) {
  return findings.length ? findings.map((finding) => `${finding.category}: ${finding.title}\n${finding.body}`).join('\n\n') : 'No work findings were identified in this saved source.'
}
