import { expect, test } from 'bun:test'
import { officeContent } from '../../web/lib/office-content'
import { applyDocumentEdits, findText, formatParagraph, formatText, insertText, readDocument, replaceText } from '../src/editing/docs'
import { addSheet, applySpreadsheetEdits, clearRange, deleteSheet, formatRange, insertColumns, insertRows, readRange, readWorkbook, renameSheet, setCells, setFormulas } from '../src/editing/spreadsheets'
import { createOfficeApp } from '../src/app'

function doc() {
  const content = officeContent('DOCUMENT', 'doc', 'Brief', { format: 'markdown', text: 'Hello world\nKeep me' })
  if (content.kind !== 'DOCUMENT') throw new Error('Wrong kind')
  content.snapshot.body!.textRuns = [{ st: 6, ed: 11, ts: { bl: 1, fs: 14 } }]
  content.snapshot.body!.paragraphs![1].paragraphStyle = { spaceAbove: { v: 8 } }
  return content
}
function workbook() {
  const content = officeContent('SPREADSHEET', 'book', 'Budget')
  if (content.kind !== 'SPREADSHEET') throw new Error('Wrong kind')
  content.snapshot.sheets['1'].cellData = { 0: { 0: { v: 5, t: 2, s: { bl: 1, bg: { rgb: '#ff0000' } } }, 1: { f: '=A1' } } }
  content.snapshot.resources = [{ name: 'CUSTOM_PLUGIN', data: '{"keep":true}' }]
  return content
}
const range = { sheetId: '1', row: 0, column: 0, rows: 1, columns: 1 }

test('document insertion shifts styled runs and paragraphs through Univer without changing source or resources', () => {
  const original = doc(), before = structuredClone(original)
  const result = insertText(original, { index: 0, text: 'New ' })
  expect(readDocument(result).body.dataStream).toBe('New Hello world\rKeep me\r\n')
  expect(result.snapshot.body!.textRuns).toContainEqual({ st: 10, ed: 15, ts: { bl: 1, fs: 14 } })
  expect(result.snapshot.body!.paragraphs![1].paragraphStyle).toEqual(before.snapshot.body!.paragraphs![1].paragraphStyle)
  expect(result.snapshot.documentStyle).toMatchObject(original.snapshot.documentStyle!)
  expect(original).toEqual(before)
})

test('document range replacement, style merging, paragraph formatting and sequential offsets', () => {
  const original = doc()
  expect(findText(original, 'world')).toEqual([{ start: 6, end: 11, segmentId: '' }])
  const styledReplacement = replaceText(original, { start: 6, end: 11, expectedText: 'world', text: 'planet' })
  expect(styledReplacement.snapshot.body!.textRuns).toContainEqual({ st: 6, ed: 12, ts: { bl: 1, fs: 14 } })
  const replaced = replaceText(original, { start: 0, end: 5, expectedText: 'Hello', text: 'Hi' })
  const formatted = formatText(replaced, { start: 3, end: 8, style: { it: 1 } })
  expect(formatted.snapshot.body!.textRuns).toContainEqual({ st: 3, ed: 8, ts: { bl: 1, fs: 14, it: 1 } })
  const paragraphId = readDocument(formatted).body.paragraphs![1].paragraphId!
  const paragraph = formatParagraph(formatted, { paragraphId, style: { spaceBelow: { v: 4 } } })
  expect(paragraph.snapshot.body!.paragraphs![1].paragraphStyle).toMatchObject({ spaceAbove: { v: 8 }, spaceBelow: { v: 4 } })
  const final = applyDocumentEdits(original, [{ type: 'insertText', index: 0, text: 'X' }, { type: 'deleteText', start: 1, end: 6, expectedText: 'Hello' }])
  expect(readDocument(final).body.dataStream).toBe('X world\rKeep me\r\n')
})

test('document batches reject stale text, protected terminators, bad operations and roll back partial edits', () => {
  const original = doc(), before = structuredClone(original)
  expect(() => applyDocumentEdits(original, [{ type: 'insertText', index: 0, text: 'X' }, { type: 'replaceText', start: 1, end: 6, text: 'bad', expectedText: 'stale' }])).toThrow('Text changed')
  expect(() => replaceText(original, { start: 0, end: 1000, text: '', expectedText: '' })).toThrow()
  expect(() => applyDocumentEdits(original, [{ type: 'unknown' } as never])).toThrow()
  expect(original).toEqual(before)
})

test('cell writes keep existing styles, literal strings and plugin resources; formulas are explicit', () => {
  const original = workbook(), before = structuredClone(original)
  const literal = setCells(original, { ...range, values: [['00123']] })
  expect(readRange(literal, range).cells[0][0]).toMatchObject({ v: '00123', t: 1, s: { bl: 1, bg: { rgb: '#ff0000' } } })
  const formula = setFormulas(literal, { ...range, formulas: [['=SUM(B1:B2)']] })
  expect(readRange(formula, range).cells[0][0]?.f).toBe('=SUM(B1:B2)')
  const text = setCells(formula, { ...range, values: [['=literal']] })
  expect(readRange(text, range).cells[0][0]).toMatchObject({ v: '=literal', t: 1 })
  expect(readRange(text, range).cells[0][0]?.f).toBeUndefined()
  const cleared = clearRange(text, range)
  expect(readRange(cleared, range).cells[0][0]?.s).toEqual(before.snapshot.sheets['1'].cellData![0][0]!.s)
  expect(cleared.snapshot.resources).toContainEqual(original.snapshot.resources![0])
  expect(original).toEqual(before)
})

test('structural spreadsheet edits update formulas and formatting, including cross-sheet references', () => {
  const initial = workbook()
  initial.snapshot.resources = []
  let content = addSheet(initial, { name: 'Other', rows: 20, columns: 10 })
  const other = readWorkbook(content).sheets.find((sheet) => sheet.name === 'Other')!.id
  content = setFormulas(content, { ...range, sheetId: other, formulas: [["='Sheet 1'!A1"]] })
  content = insertRows(content, { sheetId: '1', index: 0, count: 1 })
  expect(readRange(content, { ...range, row: 1, column: 1 }).cells[0][0]?.f).toBe('=A2')
  expect(readRange(content, { ...range, sheetId: other }).cells[0][0]?.f).toContain('A2')
  content = insertColumns(content, { sheetId: '1', index: 0, count: 1 })
  expect(readRange(content, { ...range, row: 1, column: 2 }).cells[0][0]?.f).toBe('=B2')
  content = renameSheet(content, { sheetId: '1', name: 'Actuals' })
  expect(readRange(content, { ...range, sheetId: other }).cells[0][0]?.f).toContain('Actuals')
  content = deleteSheet(content, { sheetId: other })
  expect(readWorkbook(content).sheets).toHaveLength(1)
})

test('range formatting merges styles and invalid batches leave the source untouched', () => {
  const original = workbook(), before = structuredClone(original)
  const formatted = formatRange(original, { ...range, style: { italic: true, horizontalAlignment: 'right' } })
  const style = readRange(formatted, range).cells[0][0]?.s
  expect(typeof style === 'string' ? formatted.snapshot.styles[style] : style).toMatchObject({ bl: 1, it: 1, bg: { rgb: '#ff0000' } })
  expect(() => applySpreadsheetEdits(original, [{ type: 'setCells', ...range, values: [[9]] }, { type: 'deleteSheet', sheetId: '1' }])).toThrow('Structural edits require')
  expect(() => setCells(original, { ...range, values: [[]] })).toThrow('dimensions')
  expect(() => readRange(original, { ...range, rows: 1000, columns: 26 })).toThrow()
  expect(original).toEqual(before)
})

test('opaque document resources survive formatting, and edits that could invalidate their offsets are rejected', () => {
  const content = doc()
  content.snapshot.resources = [{ name: 'CUSTOM_PLUGIN', data: '{"offset":10}' }]
  const formatted = formatText(content, { start: 0, end: 5, style: { bl: 1 } })
  expect(formatted.snapshot.resources).toContainEqual(content.snapshot.resources[0])
  expect(() => insertText(content, { index: 0, text: 'New ' })).toThrow('Structural edits require')
})

test('private editing route requires service auth and returns a validated snapshot', async () => {
  const secret = 'x'.repeat(32), app = createOfficeApp(secret)
  const body = JSON.stringify({ content: doc(), edits: [{ type: 'insertText', index: 0, text: 'New ' }] })
  const unauthorized = await app.request('/edit', { method: 'POST', body })
  expect(unauthorized.status).toBe(401)
  const response = await app.request('/edit', { method: 'POST', body, headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' } })
  expect(response.status).toBe(200)
  expect(readDocument((await response.json()).content).body.dataStream).toStartWith('New ')
  const invalid = await app.request('/edit', { method: 'POST', body: JSON.stringify({ content: doc(), edits: [null] }), headers: { Authorization: `Bearer ${secret}` } })
  expect(invalid.status).toBe(422)
})
