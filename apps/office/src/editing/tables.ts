import {
  DataStreamTreeTokenType as Token, JSONX, TextX, TextXActionType,
  TableAlignmentType, TableRowHeightRule, TableSizeType, TableTextWrapType,
  ObjectRelativeFromH, ObjectRelativeFromV, createParagraphId, createSectionId,
  type IDocumentBody, type IDocumentData, type ITable,
} from '@univerjs/core'
import type { FUniver } from '@univerjs/core/facade'
import type { InsertTableEdit } from '../../../../shared/word-editing'
import { editText, integer, requireEdit } from './common'

export function tableCells(snapshot: IDocumentData, tableId: string) {
  const body = snapshot.body!
  const range = body.tables?.find((table) => table.tableId === tableId)
  requireEdit(range && snapshot.tableSource?.[tableId], 'Table not found. Read the document again.')
  const rows: { row: number; column: number; start: number; end: number; text: string }[][] = []
  let row = -1, start = -1
  for (let i = range.startIndex + 1; i < range.endIndex - 1; i++) {
    const token = body.dataStream[i]
    requireEdit(token !== Token.TABLE_START, 'Nested tables are not supported by cell editing.')
    if (token === Token.TABLE_ROW_START) { row++; rows.push([]) }
    if (token === Token.TABLE_CELL_START) start = i + 1
    if (token === Token.TABLE_CELL_END) {
      requireEdit(row >= 0 && start >= 0 && body.dataStream.slice(i - 2, i) === '\r\n', 'Invalid table cell structure.')
      rows[row].push({ row, column: rows[row].length, start, end: i - 2, text: body.dataStream.slice(start, i - 2) })
      start = -1
    }
  }
  return { tableId, start: range.startIndex, end: range.endIndex, rows, properties: structuredClone(snapshot.tableSource[tableId]) }
}

export function validateCellText(text: unknown): asserts text is string {
  editText(text)
  requireEdit(text.length <= 10_000 && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text), 'Invalid table cell text. Use plain text without document control characters.')
}

/** Construct the same native table stream and metadata as Univer's table command,
 * without depending on its browser selection, canvas or DOM services. */
export function insertNativeTable(api: FUniver, snapshot: IDocumentData, edit: InsertTableEdit): boolean {
  const body = snapshot.body!
  integer(edit.index, 0, body.dataStream.length - 2, 'table insertion index')
  requireEdit(!body.tables?.some((table) => edit.index > table.startIndex && edit.index < table.endIndex)
    && !body.blockRanges?.some((block) => edit.index > block.startIndex && edit.index <= block.endIndex)
    && !body.customBlocks?.some((block) => block.startIndex === edit.index), 'Insert tables outside existing tables and blocks.')
  requireEdit(Array.isArray(edit.cells) && edit.cells.length > 0 && edit.cells.length <= 100, 'Provide 1–100 table rows.')
  const columns = edit.cells[0]?.length
  integer(columns, 1, 20, 'table column count')
  requireEdit(edit.cells.length * columns <= 1000, 'Keep tables within 1,000 cells.')
  for (const row of edit.cells) {
    requireEdit(Array.isArray(row) && row.length === columns, 'Table rows must have the same number of cells.')
    row.forEach(validateCellText)
  }
  requireEdit(edit.headerRow === undefined || typeof edit.headerRow === 'boolean', 'Invalid table header option.')
  const style = snapshot.documentStyle
  const pageWidth = style.pageSize?.width ?? 794
  const width = pageWidth - (style.marginLeft ?? 72) - (style.marginRight ?? 72)
  requireEdit(Number.isFinite(width) && width > 0, 'Invalid page width for a table.')
  const widths = edit.columnWidths ?? Array.from({ length: columns }, () => width / columns)
  requireEdit(Array.isArray(widths) && widths.length === columns && widths.every((value) => Number.isFinite(value) && value > 0)
    && widths.reduce((sum, value) => sum + value, 0) <= width + 0.01, 'Column widths must be positive and fit the page content width.')
  const tableId = crypto.randomUUID()
  const paragraphIds = new Set(body.paragraphs?.map((paragraph) => paragraph.paragraphId).filter((id): id is string => !!id))
  const sectionIds = new Set(body.sectionBreaks?.map((section) => section.sectionId).filter((id): id is string => !!id))
  const insertion: IDocumentBody = { dataStream: '', paragraphs: [], sectionBreaks: [], textRuns: [] }
  const paragraph = () => insertion.paragraphs!.push({ startIndex: insertion.dataStream.length - 1, paragraphId: createParagraphId(paragraphIds) })
  if (edit.index === 0 || body.dataStream[edit.index - 1] !== '\r') { insertion.dataStream += '\r'; paragraph() }
  const tableStart = insertion.dataStream.length
  insertion.dataStream += Token.TABLE_START
  for (let r = 0; r < edit.cells.length; r++) {
    insertion.dataStream += Token.TABLE_ROW_START
    for (const text of edit.cells[r]) {
      insertion.dataStream += Token.TABLE_CELL_START
      const start = insertion.dataStream.length
      const normalized = text.replace(/\r\n|\r|\n/g, '\r')
      for (const char of normalized) { insertion.dataStream += char; if (char === '\r') paragraph() }
      insertion.dataStream += '\r'; paragraph()
      if (r === 0 && edit.headerRow && normalized.length) insertion.textRuns!.push({ st: start, ed: start + normalized.length, ts: { bl: 1 } })
      insertion.dataStream += '\n'
      insertion.sectionBreaks!.push({ startIndex: insertion.dataStream.length - 1, sectionId: createSectionId(sectionIds) })
      insertion.dataStream += Token.TABLE_CELL_END
    }
    insertion.dataStream += Token.TABLE_ROW_END
  }
  insertion.dataStream += Token.TABLE_END
  insertion.tables = [{ startIndex: tableStart, endIndex: insertion.dataStream.length, tableId }]
  insertion.dataStream += '\r'; paragraph()
  requireEdit(insertion.dataStream.length <= 100_000, 'Keep table text within 100,000 characters.')
  const table: ITable = {
    tableId, tableColumns: widths.map((value) => ({ size: { type: TableSizeType.SPECIFIED, width: { v: value } } })),
    tableRows: edit.cells.map((row, index) => ({
      tableCells: row.map(() => ({ margin: { start: { v: 8 }, end: { v: 8 }, top: { v: 4 }, bottom: { v: 4 } } })),
      trHeight: { val: { v: 24 }, hRule: TableRowHeightRule.AUTO },
      ...(index === 0 && edit.headerRow ? { repeatHeaderRow: 1 as const } : {}),
    })),
    align: TableAlignmentType.START, indent: { v: 0 }, textWrap: TableTextWrapType.NONE,
    position: { positionH: { relativeFrom: ObjectRelativeFromH.PAGE, posOffset: 0 }, positionV: { relativeFrom: ObjectRelativeFromV.PAGE, posOffset: 0 } },
    dist: { distB: 0, distL: 0, distR: 0, distT: 0 },
    size: { type: TableSizeType.SPECIFIED, width: { v: widths.reduce((sum, value) => sum + value, 0) } },
  }
  const textX = new TextX()
  if (edit.index) textX.push({ t: TextXActionType.RETAIN, len: edit.index })
  textX.push({ t: TextXActionType.INSERT, len: insertion.dataStream.length, body: insertion })
  const json = JSONX.getInstance()
  const actions = JSONX.compose(json.editOp(textX.serialize(), ['body']),
    json.replaceOp(['tableSource'], snapshot.tableSource, { ...snapshot.tableSource, [tableId]: table }))
  return Boolean(api.syncExecuteCommand('doc.mutation.rich-text-editing', { unitId: snapshot.id, actions, textRanges: null, noNeedSetTextRange: true, noHistory: true }))
}
