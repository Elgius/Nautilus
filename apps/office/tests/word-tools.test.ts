import { expect, test } from 'bun:test'
import { officeContent } from '../../web/lib/office-content'
import { applyDocumentEdits, readDocument, readTable, documentCapabilities } from '../src/editing/docs'
import { createOfficeApp } from '../src/app'
import { createEditingRuntime } from '../src/editing/runtime'
import type { DocumentEdit } from '../src/editing/docs'

const cells = [['Whale', 'Approximate adult length'], ['Blue whale', '24–30 m'], ['Humpback whale', '12–16 m']]
const original = () => officeContent('DOCUMENT', 'whales', 'Whales', { format: 'markdown', text: 'Marine mammals.\nKeep this paragraph.' })
const insert = { type: 'insertTable' as const, index: 16, cells, headerRow: true }

test('native tables preserve surrounding paragraphs, styles and source and remain editable after reopening', () => {
  const base = original()
  if (base.kind !== 'DOCUMENT') throw new Error('Expected document')
  base.snapshot.body!.textRuns = [{ st: 0, ed: 6, ts: { it: 1, ff: 'Arial' } }]
  const before = structuredClone(base)
  const result = applyDocumentEdits(base, [insert])
  expect(base).toEqual(before)
  expect(result.snapshot.body!.tables).toHaveLength(1)
  const id = result.snapshot.body!.tables![0].tableId
  const table = readTable(result, id)
  expect(table.rows.map((row) => row.map((cell) => cell.text))).toEqual(cells)
  expect(result.snapshot.body!.textRuns).toContainEqual({ st: 0, ed: 6, ts: { it: 1, ff: 'Arial' } })
  expect(result.snapshot.body!.paragraphs?.find((p) => p.paragraphId === before.snapshot.body!.paragraphs![1].paragraphId)).toBeDefined()
  expect(result.snapshot.body!.dataStream).toEndWith('Keep this paragraph.\r\n')
  expect(table.properties.tableRows[0].repeatHeaderRow).toBe(1)
  const runtime = createEditingRuntime()
  try {
    const reopened = runtime.api.createDocument(structuredClone(result.snapshot))
    const edited = applyDocumentEdits({ ...result, snapshot: reopened.save() }, [{ type: 'setTableCell', tableId: id, row: 1, column: 1, expectedText: '24–30 m', text: 'Approximately 24–30 m' }])
    expect(readTable(edited, id).rows[1][1].text).toBe('Approximately 24–30 m')
    expect(readTable(edited, id).rows[2][0].text).toBe('Humpback whale')
    expect(edited.snapshot.body!.tables![0].tableId).toBe(id)
  } finally { runtime.dispose() }
})

test('table validation rejects malformed, oversized, nested and stale edits atomically', () => {
  const base = original(), before = structuredClone(base)
  const invalid: DocumentEdit[] = [
    { ...insert, cells: [['One'], ['Two', 'Three']] },
    { ...insert, cells: [['bad\u001a']] },
    { ...insert, columnWidths: [10000, 10000] },
    { ...insert, cells: Array.from({ length: 100 }, () => Array.from({ length: 20 }, () => 'x')) },
  ]
  for (const edit of invalid) expect(() => applyDocumentEdits(base, [{ type: 'insertText', index: 0, text: 'Draft ' }, edit])).toThrow()
  expect(base).toEqual(before)
  const result = applyDocumentEdits(base, [insert]), id = result.snapshot.body!.tables![0].tableId
  const table = readTable(result, id)
  expect(() => applyDocumentEdits(result, [{ ...insert, index: table.rows[0][0].start }])).toThrow('outside existing tables')
  expect(() => applyDocumentEdits(result, [{ type: 'setTableCell', tableId: id, row: 1, column: 0, expectedText: 'stale', text: 'Changed' }])).toThrow('changed')
  expect(() => applyDocumentEdits(result, [{ type: 'deleteText', start: table.start, end: table.end, expectedText: result.snapshot.body!.dataStream.slice(table.start, table.end) }])).toThrow('boundaries')
})

test('font controls merge supported styles and capabilities report missing features honestly', () => {
  const result = applyDocumentEdits(original(), [
    { type: 'formatText', start: 0, end: 6, style: { it: 1 } },
    { type: 'formatFont', start: 0, end: 6, style: { fontFamily: 'Arial', fontSize: 16, bold: true, color: '#123456' } },
  ])
  expect(result.snapshot.body!.textRuns).toContainEqual({ st: 0, ed: 6, ts: { it: 1, ff: 'Arial', fs: 16, bl: 1, cl: { rgb: '#123456' } } })
  expect(documentCapabilities(result)).toMatchObject({ tables: { native: true, insertion: true }, charts: { native: false }, fonts: { installedFamilies: null } })
  result.snapshot.resources = [{ name: 'UNKNOWN', data: '{"offset":1}' }]
  expect(documentCapabilities(result).tables.insertion).toBe(false)
  expect(() => applyDocumentEdits(result, [insert])).toThrow('Structural edits require')
})

test('empty drawing envelopes allow structural edits while populated or unknown envelopes remain protected', () => {
  const base = original()
  if (base.kind !== 'DOCUMENT') throw new Error('Expected document')
  const empty = { name: 'DOC_DRAWING_PLUGIN', data: '{"data":{},"order":[]}' }
  base.snapshot.resources = [empty]
  expect(applyDocumentEdits(base, [insert]).snapshot.resources).toContainEqual(empty)
  for (const data of ['{"data":{"image":{"offset":2}},"order":["image"]}', '{"data":{},"order":[],"unknown":{"offset":2}}', 'not json']) {
    base.snapshot.resources = [{ ...empty, data }]
    expect(() => applyDocumentEdits(base, [insert])).toThrow('Structural edits require')
  }
})

test('Office transport supports native table reads and DOCX round trips with fonts and subsequent cell edits', async () => {
  const token = 'test-only-word-tools-token-1234567890', app = createOfficeApp(token)
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  const content = applyDocumentEdits(original(), [insert, { type: 'formatFont', start: 0, end: 6, style: { fontFamily: 'Arial', fontSize: 16, bold: true } }])
  const tableId = content.snapshot.body!.tables![0].tableId
  const read = await app.request('/read', { method: 'POST', headers, body: JSON.stringify({ content, operation: 'readTable', tableId }) })
  expect(read.status).toBe(200)
  expect((await read.json()).rows[1][0].text).toBe('Blue whale')
  const exported = await app.request('/export', { method: 'POST', headers, body: JSON.stringify(content) })
  expect(exported.status).toBe(200)
  const form = new FormData()
  form.set('file', new File([await exported.arrayBuffer()], 'whales.docx'))
  const response = await app.request('/import/DOCUMENT', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form })
  expect(response.status).toBe(200)
  const reopened = (await response.json()).content
  expect(reopened.snapshot.body.tables).toHaveLength(1)
  expect(reopened.snapshot.body.textRuns.some((run: { ts?: { ff?: string; bl?: number; fs?: number } }) => run.ts?.ff === 'Arial' && run.ts.bl === 1 && run.ts.fs === 16)).toBe(true)
  const reopenedId = reopened.snapshot.body.tables[0].tableId
  expect(readTable(reopened, reopenedId).rows.map((row) => row.map((cell) => cell.text))).toEqual(cells)
  const edited = applyDocumentEdits(reopened, [{ type: 'setTableCell', tableId: reopenedId, row: 1, column: 0, expectedText: 'Blue whale', text: 'Blue whale (adult)' }])
  expect(readDocument(edited).body.dataStream).toContain('Blue whale (adult)')
})

test('large table windows bound cells and properties and retain absolute edit coordinates over transport', async () => {
  const content = applyDocumentEdits(original(), [{ ...insert, cells: Array.from({ length: 100 }, () => Array.from({ length: 10 }, () => 'x')) }])
  const tableId = content.snapshot.body!.tables![0].tableId
  const full = readTable(content, tableId)
  expect(JSON.stringify(full).length).toBeGreaterThan(60_000)
  const token = 'test-only-bounded-table-token-1234567890', app = createOfficeApp(token)
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  const collected: string[][] = []
  for (let row = 0; row < 100; row += 10) {
    const response = await app.request('/read', { method: 'POST', headers, body: JSON.stringify({ content, operation: 'readTable', tableId, row, column: 0, rows: 10, columns: 10 }) })
    expect(response.status).toBe(200)
    const text = await response.text()
    expect(text.length).toBeLessThan(59_000)
    const page = JSON.parse(text) as ReturnType<typeof readTable>
    expect(page).toMatchObject({ totalRows: 100, totalColumns: 10, range: { row, column: 0, rows: 10, columns: 10 } })
    expect(page.rows).toEqual(full.rows.slice(row, row + 10))
    expect(page.properties.tableRows).toEqual(full.properties.tableRows.slice(row, row + 10))
    collected.push(...page.rows.map((cells) => cells.map((cell) => cell.text)))
  }
  expect(collected).toEqual(Array.from({ length: 100 }, () => Array.from({ length: 10 }, () => 'x')))
  const last = readTable(content, tableId, { row: 99, column: 9 })
  expect(last.range).toEqual({ row: 99, column: 9, rows: 1, columns: 1 })
  expect(last.properties.tableColumns).toHaveLength(1)
  expect(last.properties.tableRows[0].tableCells).toHaveLength(1)
  const cell = last.rows[0][0]
  const edited = applyDocumentEdits(content, [{ type: 'setTableCell', tableId, row: cell.row, column: cell.column, expectedText: cell.text, text: 'updated' }])
  expect(readTable(edited, tableId, { row: 99, column: 9 }).rows[0][0].text).toBe('updated')
  for (const range of [{ row: -1 }, { row: 100 }, { column: 10 }, { rows: 0 }, { rows: 101 }, { columns: 11 }, { row: 0.5 }, { column: 9, columns: 2 }]) {
    expect(() => readTable(content, tableId, range)).toThrow()
  }
})
