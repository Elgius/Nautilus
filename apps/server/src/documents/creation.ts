import { z } from 'zod'
import { validateOfficeContent } from '../office-content'

const style = z.strictObject({
  bold: z.boolean().optional(), italic: z.boolean().optional(),
  fontSize: z.number().positive().max(400).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
})
const fields = {
  requestId: z.uuid().describe('Stable creation ID. Reuse this ID and identical input when retrying; never generate a new ID for an uncertain result.'),
  title: z.string().trim().min(1).max(150), category: z.string().trim().min(1).max(70).default('Notes'),
  changeSummary: z.string().trim().min(1).max(500),
}
export const createDocumentInput = z.strictObject({ ...fields,
  paragraphs: z.array(z.strictObject({ text: z.string().max(100_000).regex(/^[^\x00-\x08\x0a-\x1f]*$/), style: style.optional() })).min(1).max(1000),
}).refine((input) => input.paragraphs.reduce((size, p) => size + p.text.length, 0) <= 100_000, 'Keep document text within 100,000 characters.')
export const createSpreadsheetInput = z.strictObject({ ...fields,
  sheets: z.array(z.strictObject({
    name: z.string().trim().min(1).max(31).regex(/^[^\\/?:*\[\]]+$/),
    rows: z.number().int().min(1).max(1_048_576).optional(),
    columns: z.number().int().min(1).max(16_384).optional(),
    cells: z.array(z.strictObject({
      row: z.number().int().min(0).max(1_048_575), column: z.number().int().min(0).max(16_383),
      value: z.union([z.string().max(10_000), z.number(), z.boolean(), z.null()]).optional(),
      formula: z.string().startsWith('=').max(10_000).optional(), style: style.optional(),
    }).refine((cell) => cell.formula === undefined || cell.value === undefined, 'Use either a literal value or a formula.')).max(10_000),
  })).min(1).max(100),
}).superRefine(({ sheets }, ctx) => {
  if (new Set(sheets.map((sheet) => sheet.name.toLowerCase())).size !== sheets.length) ctx.addIssue({ code: 'custom', message: 'Sheet names must be unique.' })
  if (sheets.reduce((count, sheet) => count + sheet.cells.length, 0) > 10_000) ctx.addIssue({ code: 'custom', message: 'Limit creation to 10,000 cells.' })
  for (const sheet of sheets) {
    const positions = new Set<string>()
    for (const cell of sheet.cells) {
      const key = `${cell.row}:${cell.column}`
      if (positions.has(key) || cell.row >= (sheet.rows ?? 1_048_576) || cell.column >= (sheet.columns ?? 16_384)) ctx.addIssue({ code: 'custom', message: 'Cells must have unique positions within sheet dimensions.' })
      positions.add(key)
    }
  }
})
export type DocumentCreation = ({ kind: 'DOCUMENT' } & z.infer<typeof createDocumentInput>) | ({ kind: 'SPREADSHEET' } & z.infer<typeof createSpreadsheetInput>)
export type CreationResult = { documentId: string; versionId: string; versionNumber: number; requestId: string; saved: true; replayed: boolean }

export function parseCreation(input: DocumentCreation): DocumentCreation {
  const { kind, ...data } = input
  const parsed: DocumentCreation = kind === 'DOCUMENT' ? { kind, ...createDocumentInput.parse(data) } : { kind, ...createSpreadsheetInput.parse(data) }
  if (new TextEncoder().encode(JSON.stringify(parsed)).byteLength > 120_000) throw new Error('Keep creation input within 120 KB.')
  return parsed
}
function textStyle(input: z.infer<typeof style> = {}) {
  return { ...(input.bold === undefined ? {} : { bl: input.bold ? 1 : 0 }),
    ...(input.italic === undefined ? {} : { it: input.italic ? 1 : 0 }),
    ...(input.fontSize === undefined ? {} : { fs: input.fontSize }), ...(input.color ? { cl: { rgb: input.color } } : {}) }
}
export function creationContent(input: DocumentCreation, id: string) {
  if (input.kind === 'DOCUMENT') {
    let dataStream = ''
    const paragraphs: { startIndex: number; paragraphId: string }[] = []
    const textRuns: { st: number; ed: number; ts: ReturnType<typeof textStyle> }[] = []
    input.paragraphs.forEach((paragraph, index) => {
      const start = dataStream.length
      dataStream += paragraph.text
      if (paragraph.style && paragraph.text.length) textRuns.push({ st: start, ed: dataStream.length, ts: textStyle(paragraph.style) })
      paragraphs.push({ startIndex: dataStream.length, paragraphId: `paragraph-${index}` })
      dataStream += '\r'
    })
    return validateOfficeContent(input.kind, { format: 'univer', kind: input.kind, snapshot: { id, title: input.title,
      documentStyle: { documentFlavor: 1, pageSize: { width: 794, height: 1123 }, marginTop: 72, marginBottom: 72, marginLeft: 72, marginRight: 72 },
      body: { dataStream: dataStream + '\n', paragraphs, textRuns },
    } })
  }
  const sheets = Object.fromEntries(input.sheets.map((sheet, index) => {
    const sheetId = `sheet-${index + 1}`
    const cellData: Record<number, Record<number, unknown>> = {}
    for (const cell of sheet.cells) {
      const value = cell.formula !== undefined ? { f: cell.formula } : cell.value == null ? {} : {
        v: cell.value, t: typeof cell.value === 'number' ? 2 : typeof cell.value === 'boolean' ? 3 : 1,
      }
      ;(cellData[cell.row] ??= {})[cell.column] = { ...value, ...(cell.style ? { s: textStyle(cell.style) } : {}) }
    }
    return [sheetId, { id: sheetId, name: sheet.name, cellData,
      rowCount: sheet.rows ?? Math.max(100, ...sheet.cells.map((cell) => cell.row + 1)),
      columnCount: sheet.columns ?? Math.max(26, ...sheet.cells.map((cell) => cell.column + 1)),
    }]
  }))
  return validateOfficeContent(input.kind, { format: 'univer', kind: input.kind, snapshot: {
    id, name: input.title, appVersion: '1.2.0', locale: 'enUS', styles: {}, sheetOrder: Object.keys(sheets), sheets,
  } })
}
