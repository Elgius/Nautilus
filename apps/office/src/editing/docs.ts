import type { IDocumentData, IParagraphStyle, ITextStyle } from '@univerjs/core'
import { createEditingRuntime, preserveResources } from './runtime'
import { batch, contentSnapshot, editText, integer, patch, requireEdit } from './common'
import type { FormatFontEdit, InsertTableEdit, SetTableCellEdit, TableReadRange } from '../../../../shared/word-editing'
import { insertNativeTable, tableCells, validateCellText } from './tables'

export type DocumentContent = { format: 'univer'; kind: 'DOCUMENT'; snapshot: IDocumentData }
export type TextRange = { start: number; end: number; segmentId?: string }
export type DocumentEdit =
  | InsertTableEdit | SetTableCellEdit | FormatFontEdit
  | { type: 'insertText'; index: number; text: string; segmentId?: string }
  | ({ type: 'replaceText'; text: string; expectedText: string } & TextRange)
  | ({ type: 'deleteText'; expectedText: string } & TextRange)
  | ({ type: 'formatText'; style: ITextStyle } & TextRange)
  | { type: 'formatParagraph'; paragraphId: string; style: IParagraphStyle; segmentId?: string }

/** Read the complete Univer body, including style runs and stable paragraph IDs. */
export function readDocument(content: unknown, segmentId = '') {
  const snapshot = contentSnapshot('DOCUMENT', content) as unknown as IDocumentData
  const body = segmentId ? (snapshot.headers?.[segmentId] ?? snapshot.footers?.[segmentId])?.body : snapshot.body
  requireEdit(body, 'Document segment not found.')
  return structuredClone({ id: snapshot.id, title: snapshot.title, segmentId, body,
    tableSource: snapshot.tableSource ?? {},
    tables: (body.tables ?? []).map((table) => ({ ...table, rows: snapshot.tableSource?.[table.tableId]?.tableRows.length, columns: snapshot.tableSource?.[table.tableId]?.tableColumns.length })),
  })
}

/** Literal, case-sensitive matches; offsets are UTF-16 and ends are exclusive. */
export function findText(content: unknown, text: string, segmentId = ''): TextRange[] {
  editText(text)
  requireEdit(text.length > 0, 'Search text cannot be empty.')
  const { body } = readDocument(content, segmentId)
  const matches: TextRange[] = []
  for (let index = body.dataStream.indexOf(text); index >= 0; index = body.dataStream.indexOf(text, index + text.length)) {
    if (index + text.length <= body.dataStream.length - 2) matches.push({ start: index, end: index + text.length, segmentId })
    requireEdit(matches.length <= 10_000, 'Too many text matches; narrow the search.')
  }
  return matches
}

/** Sequential edits on an isolated copy. Failure never mutates the caller's snapshot. */
export function applyDocumentEdits(content: unknown, edits: DocumentEdit[]): DocumentContent {
  const snapshot = contentSnapshot('DOCUMENT', content) as unknown as IDocumentData
  batch(edits)
  const runtime = createEditingRuntime()
  try {
    const document = runtime.api.createDocument(structuredClone(snapshot))
    for (const edit of edits) {
      const segmentId = 'segmentId' in edit ? edit.segmentId ?? '' : ''
      requireEdit(typeof segmentId === 'string', 'Invalid segment ID.')
      const body = readDocument({ format: 'univer', kind: 'DOCUMENT', snapshot: document.save() }, segmentId).body
      const limit = body.dataStream.length - 2
      let success: boolean
      if (edit.type === 'insertTable') {
        runtime.assertStructuralResources(snapshot.resources)
        success = insertNativeTable(runtime.api, document.save(), edit)
      } else if (edit.type === 'setTableCell') {
        const table = tableCells(document.save(), edit.tableId)
        requireEdit(table.properties.tableRows.every((row) => !row.gridBefore && !row.gridAfter && row.tableCells.every((cell) => (cell.rowSpan ?? 1) === 1 && (cell.columnSpan ?? 1) === 1)), 'Editing merged or irregular table cells is not supported yet.')
        integer(edit.row, 0, table.rows.length - 1, 'table row')
        integer(edit.column, 0, table.rows[edit.row].length - 1, 'table column')
        const cell = table.rows[edit.row][edit.column]
        requireEdit(cell.text === edit.expectedText, 'Cell text changed; read the table again.')
        validateCellText(edit.text)
        const text = edit.text.replace(/\r\n|\r|\n/g, '\r')
        if (text.length !== cell.end - cell.start) runtime.assertStructuralResources(snapshot.resources)
        if (cell.start === cell.end) success = text.length === 0 || document.insertText(cell.start, text)
        else {
          const range = document.getTextRange(cell.start, cell.end)
          const inherited = range.getCommonExplicitTextStyle()
          success = range.setText(text)
          if (success && text.length && Object.keys(inherited).length) success = document.getTextRange(cell.start, cell.start + text.length).setTextStyle(inherited)
        }
      } else if (edit.type === 'formatFont') {
        integer(edit.start, 0, limit, 'range start')
        integer(edit.end, edit.start + 1, limit, 'range end')
        patch(edit.style)
        const { fontFamily, fontSize, bold, italic, color, ...unknown } = edit.style
        requireEdit(!Object.keys(unknown).length && Object.keys(edit.style).length > 0, 'Provide supported font properties.')
        requireEdit(fontFamily === undefined || typeof fontFamily === 'string' && fontFamily.trim().length > 0 && fontFamily.length <= 200, 'Invalid font family.')
        requireEdit(fontSize === undefined || Number.isFinite(fontSize) && fontSize > 0 && fontSize <= 400, 'Invalid font size.')
        requireEdit(bold === undefined || typeof bold === 'boolean', 'Invalid bold setting.')
        requireEdit(italic === undefined || typeof italic === 'boolean', 'Invalid italic setting.')
        requireEdit(color === undefined || /^#[0-9a-f]{6}$/i.test(color), 'Invalid font color.')
        success = document.getTextRange(edit.start, edit.end, segmentId).setTextStyle({
          ...(fontFamily !== undefined ? { ff: fontFamily } : {}), ...(fontSize !== undefined ? { fs: fontSize } : {}),
          ...(bold !== undefined ? { bl: bold ? 1 : 0 } : {}), ...(italic !== undefined ? { it: italic ? 1 : 0 } : {}),
          ...(color !== undefined ? { cl: { rgb: color } } : {}),
        })
      } else if (edit.type === 'formatParagraph') {
        editText(edit.paragraphId, 'paragraph ID')
        patch(edit.style)
        const paragraph = document.getParagraph(edit.paragraphId, segmentId)
        requireEdit(paragraph, 'Paragraph not found.')
        success = paragraph.setStyle(edit.style)
      } else if (edit.type === 'insertText') {
        runtime.assertStructuralResources(snapshot.resources)
        integer(edit.index, 0, limit, 'insertion index')
        editText(edit.text)
        requireEdit(edit.text.length > 0 && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(edit.text), 'Text contains unsupported document control characters.')
        success = document.insertText(edit.index, edit.text, segmentId)
      } else {
        requireEdit(['replaceText', 'deleteText', 'formatText'].includes(edit.type), 'Unknown document edit.')
        integer(edit.start, 0, limit, 'range start')
        integer(edit.end, edit.start + 1, limit, 'range end')
        const range = document.getTextRange(edit.start, edit.end, segmentId)
        if (edit.type === 'formatText') {
          patch(edit.style)
          success = range.setTextStyle(edit.style)
        } else {
          editText(edit.expectedText, 'expected text')
          requireEdit(range.getText() === edit.expectedText, 'Text changed; read the document again.')
          requireEdit(!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(edit.expectedText) && !edit.expectedText.includes('\n'), 'Text edits cannot remove native object or cell boundaries. Use a supported object operation.')
          const replacement = edit.type === 'replaceText' ? edit.text : ''
          editText(replacement)
          if (replacement.replace(/\r\n|\n/g, '\r').length !== edit.end - edit.start) runtime.assertStructuralResources(snapshot.resources)
          requireEdit(!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(replacement), 'Text contains unsupported document control characters.')
          const inheritedStyle = range.getCommonExplicitTextStyle()
          success = range.setText(replacement)
          const insertedLength = replacement.replace(/\r\n|\n/g, '\r').length
          if (success && insertedLength && Object.keys(inheritedStyle).length) {
            success = document.getTextRange(edit.start, edit.start + insertedLength, segmentId).setTextStyle(inheritedStyle)
          }
        }
      }
      requireEdit(success, 'Univer could not apply the document edit.')
    }
    const result: DocumentContent = { format: 'univer', kind: 'DOCUMENT', snapshot: preserveResources(snapshot, document.save()) }
    contentSnapshot('DOCUMENT', result)
    return result
  } finally { runtime.dispose() }
}

export const insertText = (content: unknown, edit: Omit<Extract<DocumentEdit, { type: 'insertText' }>, 'type'>) => applyDocumentEdits(content, [{ ...edit, type: 'insertText' }])
export const replaceText = (content: unknown, edit: Omit<Extract<DocumentEdit, { type: 'replaceText' }>, 'type'>) => applyDocumentEdits(content, [{ ...edit, type: 'replaceText' }])
export const deleteText = (content: unknown, edit: Omit<Extract<DocumentEdit, { type: 'deleteText' }>, 'type'>) => applyDocumentEdits(content, [{ ...edit, type: 'deleteText' }])
export const formatText = (content: unknown, edit: Omit<Extract<DocumentEdit, { type: 'formatText' }>, 'type'>) => applyDocumentEdits(content, [{ ...edit, type: 'formatText' }])
export const formatParagraph = (content: unknown, edit: Omit<Extract<DocumentEdit, { type: 'formatParagraph' }>, 'type'>) => applyDocumentEdits(content, [{ ...edit, type: 'formatParagraph' }])

export function readTable(content: unknown, tableId: string, range: TableReadRange = {}) {
  editText(tableId, 'table ID')
  const table = tableCells(contentSnapshot('DOCUMENT', content) as unknown as IDocumentData, tableId)
  const totalRows = table.rows.length
  const totalColumns = Math.max(0, ...table.rows.map((row) => row.length))
  const row = range.row ?? 0, column = range.column ?? 0
  integer(row, 0, totalRows - 1, 'table row')
  integer(column, 0, totalColumns - 1, 'table column')
  const rows = range.rows ?? totalRows - row, columns = range.columns ?? totalColumns - column
  integer(rows, 1, totalRows - row, 'table row count')
  integer(columns, 1, totalColumns - column, 'table column count')
  return {
    ...table, totalRows, totalColumns, range: { row, column, rows, columns },
    rows: table.rows.slice(row, row + rows).map((cells) => cells.slice(column, column + columns)),
    properties: {
      ...table.properties,
      tableColumns: table.properties.tableColumns.slice(column, column + columns),
      tableRows: table.properties.tableRows.slice(row, row + rows).map((entry) => ({
        ...entry, tableCells: entry.tableCells.slice(column, column + columns),
      })),
    },
  }
}

export function documentCapabilities(content: unknown) {
  const snapshot = contentSnapshot('DOCUMENT', content) as unknown as IDocumentData
  const runtime = createEditingRuntime()
  let structuralEdits = true
  try { runtime.assertStructuralResources(snapshot.resources) } catch { structuralEdits = false } finally { runtime.dispose() }
  return {
    operations: ['formatText', 'formatFont', 'formatParagraph', ...(structuralEdits ? ['insertText', 'replaceText', 'deleteText', 'insertTable', 'setTableCell'] : [])],
    tables: { native: true, insertion: structuralEdits, cellEditing: structuralEdits, maxRows: 100, maxColumns: 20, maxCells: 1000, nestedInsertion: false },
    fonts: { family: true, size: true, bold: true, italic: true, color: true, installedFamilies: null, note: 'Font availability depends on the browser and export host; unavailable families may be substituted.' },
    charts: { native: false },
    pending: ['table row/column changes', 'merged-cell editing', 'table styling', 'native charts', 'images and captions', 'page layout tools', 'font availability discovery'],
    structuralEdits,
  }
}
