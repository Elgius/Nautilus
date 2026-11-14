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

test('native table deletion preserves surrounding text, styles, paragraph IDs, segments and resources after reopening', () => {
  const base = original()
  if (base.kind !== 'DOCUMENT') throw new Error('Expected document')
  base.snapshot.body!.textRuns = [
    { st: 0, ed: 6, ts: { it: 1, ff: 'Arial' } },
    { st: 16, ed: 20, ts: { bl: 1, fs: 18, cl: { rgb: '#123456' } } },
  ]
  base.snapshot.body!.paragraphs![1].paragraphStyle = { spaceAbove: { v: 12 } }
  base.snapshot.body!.sectionBreaks = [{ startIndex: base.snapshot.body!.dataStream.length - 1, sectionId: 'final-section' }]
  base.snapshot.body!.sectionBreaks = [{ startIndex: base.snapshot.body!.dataStream.length - 1, sectionId: 'body-section' }]
  base.snapshot.headers = { heading: { body: { dataStream: 'Header\r\n' } } }
  base.snapshot.resources = [{ name: 'DOC_DRAWING_PLUGIN', data: '{"data":{},"order":[]}' }]
  const content = applyDocumentEdits(base, [insert])
  const before = structuredClone(content)
  const table = readTable(content, content.snapshot.body!.tables![0].tableId)
  const result = applyDocumentEdits(content, [{ type: 'deleteTable', tableId: table.tableId }])
  expect(content).toEqual(before)
  expect(result.snapshot.body!.dataStream).toBe(before.snapshot.body!.dataStream.slice(0, table.start) + before.snapshot.body!.dataStream.slice(table.end))
  expect(result.snapshot.body!.dataStream).toBe('Marine mammals.\r\rKeep this paragraph.\r\n')
  expect(result.snapshot.body!.textRuns).toContainEqual(base.snapshot.body!.textRuns![0])
  expect(result.snapshot.body!.textRuns).toContainEqual({ st: 17, ed: 21, ts: base.snapshot.body!.textRuns![1].ts })
  for (const paragraph of base.snapshot.body!.paragraphs!) {
    expect(result.snapshot.body!.paragraphs).toContainEqual({ ...paragraph, startIndex: paragraph.startIndex + (paragraph.startIndex >= insert.index ? 1 : 0) })
  }
  expect(result.snapshot.body!.sectionBreaks).toEqual(base.snapshot.body!.sectionBreaks!.map((section) => ({ ...section, startIndex: section.startIndex + 1 })))
  expect(result.snapshot.body!.tables ?? []).toEqual([])
  expect(result.snapshot.tableSource).toEqual({})
  expect(result.snapshot.headers).toEqual(before.snapshot.headers)
  expect(result.snapshot.resources).toContainEqual(base.snapshot.resources[0])
  expect(() => readTable(result, table.tableId)).toThrow('Table not found')
  const runtime = createEditingRuntime()
  try {
    const reopened = runtime.api.createDocument(structuredClone(result.snapshot)).save()
    expect(reopened.body).toEqual(result.snapshot.body)
    expect(reopened.tableSource).toEqual({})
  } finally { runtime.dispose() }
})

test('deleting one table rebases a later table without changing its cells or properties and supports sequential edits', () => {
  const first = applyDocumentEdits(original(), [insert])
  const firstId = first.snapshot.body!.tables![0].tableId
  const second = applyDocumentEdits(first, [{ ...insert, index: first.snapshot.body!.dataStream.length - 2, cells: [['Retain me']] }])
  const secondId = second.snapshot.body!.tables![1].tableId
  const retained = readTable(second, secondId)
  const removed = readTable(second, firstId)
  const result = applyDocumentEdits(second, [{ type: 'deleteTable', tableId: firstId }])
  const table = readTable(result, secondId)
  expect(table.properties).toEqual(retained.properties)
  expect(table.start).toBe(retained.start - (removed.end - removed.start))
  expect(table.end).toBe(retained.end - (removed.end - removed.start))
  expect(table.rows[0][0].text).toBe('Retain me')
  expect(Object.keys(result.snapshot.tableSource!)).toEqual([secondId])
  const edited = applyDocumentEdits(second, [
    { type: 'deleteTable', tableId: firstId },
    { type: 'setTableCell', tableId: secondId, row: 0, column: 0, expectedText: 'Retain me', text: 'Still editable' },
  ])
  expect(readTable(edited, secondId).rows[0][0].text).toBe('Still editable')
  expect(applyDocumentEdits(edited, [{ type: 'deleteTable', tableId: secondId }]).snapshot.body!.tables ?? []).toEqual([])
})

test('deleting tables rejects missing IDs, malformed boundaries, unsupported resources and duplicate deletions atomically', () => {
  const content = applyDocumentEdits(original(), [insert])
  const tableId = content.snapshot.body!.tables![0].tableId
  const before = structuredClone(content)
  for (const id of ['', 'x'.repeat(201), 'missing-table']) {
    expect(() => applyDocumentEdits(content, [{ type: 'insertText', index: 0, text: 'Draft ' }, { type: 'deleteTable', tableId: id }])).toThrow()
  }
  expect(() => applyDocumentEdits(content, [{ type: 'deleteTable', tableId }, { type: 'deleteTable', tableId }])).toThrow('Table not found')
  expect(content).toEqual(before)
  const malformed = structuredClone(content)
  malformed.snapshot.body!.tables![0].endIndex++
  expect(() => applyDocumentEdits(malformed, [{ type: 'deleteTable', tableId }])).toThrow('Invalid table boundaries')
  const protectedContent = structuredClone(content)
  protectedContent.snapshot.resources = [{ name: 'UNKNOWN', data: '{"offset":1}' }]
  expect(documentCapabilities(protectedContent).tables.deletion).toBe(false)
  expect(documentCapabilities(protectedContent).operations).not.toContain('deleteTable')
  expect(() => applyDocumentEdits(protectedContent, [{ type: 'deleteTable', tableId }])).toThrow('Structural edits require')
  expect(documentCapabilities(content).tables.deletion).toBe(true)
  expect(documentCapabilities(content).operations).toContain('deleteTable')
})

test('deleting a table through Office transport survives DOCX export and import with surrounding formatting', async () => {
  const token = 'test-only-delete-table-token-1234567890', app = createOfficeApp(token)
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  const content = applyDocumentEdits(original(), [
    { type: 'formatFont', start: 16, end: 20, style: { fontFamily: 'Arial', bold: true, fontSize: 18 } }, insert,
  ])
  const tableId = content.snapshot.body!.tables![0].tableId
  const response = await app.request('/edit', { method: 'POST', headers, body: JSON.stringify({ content, edits: [{ type: 'deleteTable', tableId }] }) })
  expect(response.status).toBe(200)
  const deleted = (await response.json()).content
  expect(deleted.snapshot.body.tables ?? []).toEqual([])
  expect(deleted.snapshot.tableSource).not.toHaveProperty(tableId)
  const exported = await app.request('/export', { method: 'POST', headers, body: JSON.stringify(deleted) })
  expect(exported.status).toBe(200)
  const form = new FormData()
  form.set('file', new File([await exported.arrayBuffer()], 'removed-table.docx'))
  const imported = await app.request('/import/DOCUMENT', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form })
  expect(imported.status).toBe(200)
  const reopened = (await imported.json()).content
  expect(reopened.snapshot.body.tables ?? []).toEqual([])
  expect(reopened.snapshot.body.dataStream).toContain('Marine mammals.')
  expect(reopened.snapshot.body.dataStream).toContain('Keep this paragraph.')
  expect(reopened.snapshot.body.textRuns.some((run: { ts?: { ff?: string; bl?: number; fs?: number } }) => run.ts?.ff === 'Arial' && run.ts.bl === 1 && run.ts.fs === 18)).toBe(true)
})

test('table widths reject collapsed columns and narrow pages atomically while preserving usable widths', () => {
  const base = original(), before = structuredClone(base)
  for (const columnWidths of [[1, 1], [0.5, 0.5], [31.99, 300], [300, 1], [NaN, 300], [Infinity, 300], [100], [400, 400]]) {
    expect(() => applyDocumentEdits(base, [
      { type: 'insertText', index: 0, text: 'Draft ' },
      { ...insert, columnWidths },
    ])).toThrow('Column widths are absolute Univer layout pixels')
    expect(base).toEqual(before)
  }
  for (const columnWidths of [undefined, [32, 618], [200.5, 300.25]]) {
    const result = applyDocumentEdits(base, [{ ...insert, columnWidths }])
    const table = readTable(result, result.snapshot.body!.tables![0].tableId)
    const expectedWidths = columnWidths ?? [325, 325]
    expect(table.properties.tableColumns.map((column) => column.size.width.v)).toEqual(expectedWidths)
    expect(table.properties.size.width.v).toBe(expectedWidths.reduce((sum, width) => sum + width, 0))
    expect(table.rows.map((row) => row.map((cell) => cell.text))).toEqual(cells)
  }
  const narrow = original()
  if (narrow.kind !== 'DOCUMENT') throw new Error('Expected document')
  narrow.snapshot.documentStyle.pageSize = { width: 200, height: 1123 }
  const narrowBefore = structuredClone(narrow)
  // 56px of content width cannot hold two 32px columns, including default widths.
  expect(() => applyDocumentEdits(narrow, [insert])).toThrow('use fewer columns')
  expect(narrow).toEqual(narrowBefore)
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
