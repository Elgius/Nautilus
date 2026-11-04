import { z } from 'zod'

const index = z.number().int().nonnegative()
const count = z.number().int().min(1).max(10_000)
const text = z.string().max(100_000)
const segment = { segmentId: z.string().max(200).optional() }
const span = { start: index, end: index, ...segment }
const style = z.record(z.string(), z.json())
const operation = <T extends string, S extends z.ZodRawShape>(type: T, shape: S) => z.strictObject({ type: z.literal(type), ...shape })
export const documentEdits = z.array(z.discriminatedUnion('type', [
  operation('insertText', { index, text, ...segment }),
  operation('replaceText', { ...span, expectedText: text, text }),
  operation('deleteText', { ...span, expectedText: text }),
  operation('formatText', { ...span, style }),
  operation('formatParagraph', { paragraphId: z.string().min(1), style, ...segment }),
])).min(1).max(100)
const sheetId = z.string().min(1).max(200)
export const range = { sheetId, row: index, column: index, rows: count, columns: count }
const structure = { sheetId, index, count }
const name = z.string().min(1).max(31)
export const spreadsheetEdits = z.array(z.discriminatedUnion('type', [
  operation('setCells', { ...range, values: z.array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])).max(10_000)).max(10_000) }),
  operation('setFormulas', { ...range, formulas: z.array(z.array(z.string().startsWith('=')).max(10_000)).max(10_000) }),
  operation('clearRange', range),
  operation('formatRange', { ...range, style: z.strictObject({
    bold: z.boolean().optional(), italic: z.boolean().optional(), fontSize: z.number().positive().max(400).optional(),
    fontFamily: z.string().max(200).optional(), color: z.string().max(200).optional(), background: z.string().max(200).optional(),
    horizontalAlignment: z.enum(['left', 'center', 'right']).optional(), verticalAlignment: z.enum(['top', 'middle', 'bottom']).optional(),
  }) }),
  operation('insertRows', structure), operation('deleteRows', structure),
  operation('insertColumns', structure), operation('deleteColumns', structure),
  operation('addSheet', { name, rows: z.number().int().min(1).max(1_048_576), columns: z.number().int().min(1).max(16_384) }),
  operation('renameSheet', { sheetId, name }), operation('deleteSheet', { sheetId }),
])).min(1).max(100)
export const documentId = z.string().min(1).max(200)
export const versionId = z.string().min(1).max(200)
