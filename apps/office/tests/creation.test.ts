import { expect, test } from 'bun:test'
import { creationContent, parseCreation } from '../../server/src/documents/creation'
import { applyDocumentEdits, readDocument } from '../src/editing/docs'
import { applySpreadsheetEdits, readRange } from '../src/editing/spreadsheets'

const common = { requestId: '00000000-0000-4000-8000-000000000001', title: 'Created', category: 'Notes', changeSummary: 'Create' }
test('agent-created document opens in Univer and supports subsequent edits', () => {
  const content = creationContent(parseCreation({ ...common, kind: 'DOCUMENT', paragraphs: [{ text: 'Hello', style: { bold: true } }, { text: 'World' }] }), 'doc')
  const edited = applyDocumentEdits(content, [{ type: 'insertText', index: 5, text: '!' }])
  expect(readDocument(edited).body.dataStream).toBe('Hello!\rWorld\r\n')
})
test('agent-created workbook opens in Univer and supports subsequent edits', () => {
  const content = creationContent(parseCreation({ ...common, kind: 'SPREADSHEET', sheets: [{ name: 'Budget', cells: [{ row: 0, column: 26, value: '=literal' }, { row: 0, column: 0, formula: '=1+1' }] }] }), 'book')
  const edited = applySpreadsheetEdits(content, [{ type: 'setCells', sheetId: 'sheet-1', row: 1, column: 0, rows: 1, columns: 1, values: [[7]] }])
  const result = readRange(edited, { sheetId: 'sheet-1', row: 0, column: 26, rows: 1, columns: 1 })
  expect(JSON.stringify(result)).toContain('=literal')
})
