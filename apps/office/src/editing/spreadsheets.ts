import type { ICellData, IWorkbookData } from '@univerjs/core'
import type { FWorkbook, FWorksheet } from '@univerjs/sheets/facade'
import { createEditingRuntime, preserveResources } from './runtime'
import { batch, contentSnapshot, integer, MAX_RANGE_CELLS, requireEdit } from './common'

export type SpreadsheetContent = { format: 'univer'; kind: 'SPREADSHEET'; snapshot: IWorkbookData }
export type CellValue = string | number | boolean | null
/** Zero-based origin and positive dimensions; ranges must be inside an existing sheet. */
export type CellRange = { sheetId: string; row: number; column: number; rows: number; columns: number }
export type RangeStyle = {
  bold?: boolean; italic?: boolean; fontSize?: number; fontFamily?: string;
  color?: string; background?: string;
  horizontalAlignment?: 'left' | 'center' | 'right'; verticalAlignment?: 'top' | 'middle' | 'bottom';
}
type StructuralType = 'insertRows' | 'deleteRows' | 'insertColumns' | 'deleteColumns'
type StructuralEdit = { [T in StructuralType]: { type: T; sheetId: string; index: number; count: number } }[StructuralType]
export type SpreadsheetEdit =
  | ({ type: 'setCells'; values: CellValue[][] } & CellRange)
  | ({ type: 'setFormulas'; formulas: string[][] } & CellRange)
  | ({ type: 'clearRange' } & CellRange)
  | ({ type: 'formatRange'; style: RangeStyle } & CellRange)
  | StructuralEdit
  | { type: 'addSheet'; name: string; rows: number; columns: number }
  | { type: 'renameSheet'; sheetId: string; name: string }
  | { type: 'deleteSheet'; sheetId: string }

export function readWorkbook(content: unknown) {
  const snapshot = contentSnapshot('SPREADSHEET', content) as unknown as IWorkbookData
  return {
    id: snapshot.id, name: snapshot.name,
    sheets: snapshot.sheetOrder.map((id) => {
      const sheet = snapshot.sheets[id]
      return { id, name: sheet.name, rows: sheet.rowCount, columns: sheet.columnCount }
    }),
  }
}

function sheetById(workbook: FWorkbook, id: string): FWorksheet {
  requireEdit(typeof id === 'string', 'Provide a sheet ID.')
  const sheet = workbook.getSheetBySheetId(id)
  requireEdit(sheet, 'Sheet not found.')
  return sheet
}

function validateRange(range: CellRange, rows: number, columns: number) {
  integer(range.row, 0, rows - 1, 'row')
  integer(range.column, 0, columns - 1, 'column')
  integer(range.rows, 1, rows - range.row, 'row count')
  integer(range.columns, 1, columns - range.column, 'column count')
  requireEdit(range.rows * range.columns <= MAX_RANGE_CELLS, 'Limit each range to 10,000 cells.')
}

/** Returns stored cell data including formulas, rich text and style references; no recalculation. */
export function readRange(content: unknown, range: CellRange) {
  const snapshot = contentSnapshot('SPREADSHEET', content) as unknown as IWorkbookData
  const sheet = snapshot.sheets[range.sheetId]
  requireEdit(sheet && snapshot.sheetOrder.includes(range.sheetId), 'Sheet not found.')
  validateRange(range, sheet.rowCount!, sheet.columnCount!)
  return {
    ...range,
    cells: Array.from({ length: range.rows }, (_, r) => Array.from({ length: range.columns }, (_, c) =>
      structuredClone(sheet.cellData?.[range.row + r]?.[range.column + c] ?? null))),
    styles: structuredClone(snapshot.styles ?? {}),
  }
}

function sheetName(workbook: FWorkbook, name: string, ownId?: string) {
  requireEdit(typeof name === 'string' && name.trim().length > 0 && name.length <= 31 && !/[\\/?*\[\]:]/.test(name), 'Invalid sheet name (1–31 characters).')
  requireEdit(!workbook.getSheets().some((sheet) => sheet.getSheetId() !== ownId && sheet.getSheetName().toLowerCase() === name.toLowerCase()), 'Sheet name already exists.')
}

function format(sheet: FWorksheet, edit: Extract<SpreadsheetEdit, { type: 'formatRange' }>) {
  const style = edit.style
  requireEdit(style && typeof style === 'object' && !Array.isArray(style), 'Provide a range style.')
  requireEdit(Object.keys(style).every((key) => ['bold', 'italic', 'fontSize', 'fontFamily', 'color', 'background', 'horizontalAlignment', 'verticalAlignment'].includes(key)), 'Unsupported range style.')
  const range = sheet.getRange(edit.row, edit.column, edit.rows, edit.columns)
  for (const key of ['bold', 'italic'] as const) if (style[key] !== undefined) requireEdit(typeof style[key] === 'boolean', `Invalid ${key}.`)
  if (style.fontSize !== undefined) requireEdit(typeof style.fontSize === 'number' && Number.isFinite(style.fontSize) && style.fontSize > 0 && style.fontSize <= 400, 'Invalid font size.')
  for (const key of ['color', 'background', 'fontFamily'] as const) if (style[key] !== undefined) requireEdit(typeof style[key] === 'string' && style[key].length > 0 && style[key].length <= 200, `Invalid ${key}.`)
  if (style.horizontalAlignment !== undefined) requireEdit(['left', 'center', 'right'].includes(style.horizontalAlignment), 'Invalid horizontal alignment.')
  if (style.verticalAlignment !== undefined) requireEdit(['top', 'middle', 'bottom'].includes(style.verticalAlignment), 'Invalid vertical alignment.')
  if (style.bold !== undefined) range.setFontWeight(style.bold ? 'bold' : 'normal')
  if (style.italic !== undefined) range.setFontStyle(style.italic ? 'italic' : 'normal')
  if (style.fontSize !== undefined) range.setFontSize(style.fontSize)
  if (style.fontFamily !== undefined) range.setFontFamily(style.fontFamily)
  if (style.color !== undefined) range.setFontColor(style.color)
  if (style.background !== undefined) range.setBackground(style.background)
  if (style.horizontalAlignment !== undefined) range.setHorizontalAlignment(style.horizontalAlignment === 'right' ? 'normal' : style.horizontalAlignment)
  if (style.verticalAlignment !== undefined) range.setVerticalAlignment(style.verticalAlignment)
}

/** Atomic from the caller's perspective: only returns a snapshot if every sequential edit succeeds. */
export function applySpreadsheetEdits(content: unknown, edits: SpreadsheetEdit[]): SpreadsheetContent {
  const snapshot = contentSnapshot('SPREADSHEET', content) as unknown as IWorkbookData
  batch(edits)
  const runtime = createEditingRuntime()
  try {
    const workbook = runtime.api.createWorkbook(structuredClone(snapshot))
    for (const edit of edits) {
      if (['addSheet', 'renameSheet', 'deleteSheet', 'insertRows', 'deleteRows', 'insertColumns', 'deleteColumns'].includes(edit.type)) runtime.assertStructuralResources(snapshot.resources)
      if (edit.type === 'addSheet') {
        sheetName(workbook, edit.name)
        integer(edit.rows, 1, 1_048_576, 'sheet rows')
        integer(edit.columns, 1, 16_384, 'sheet columns')
        requireEdit(workbook.getNumSheets() < 100, 'Keep at most 100 sheets.')
        workbook.create(edit.name, edit.rows, edit.columns)
        continue
      }
      const sheet = sheetById(workbook, edit.sheetId)
      if (edit.type === 'renameSheet') {
        sheetName(workbook, edit.name, edit.sheetId)
        sheet.setName(edit.name)
      } else if (edit.type === 'deleteSheet') {
        requireEdit(workbook.getNumSheets() > 1, 'Cannot delete the final sheet.')
        requireEdit(workbook.deleteSheet(sheet), 'Could not delete sheet.')
      } else if (edit.type === 'insertRows' || edit.type === 'deleteRows' || edit.type === 'insertColumns' || edit.type === 'deleteColumns') {
        const rows = edit.type.endsWith('Rows'), insert = edit.type.startsWith('insert')
        const size = rows ? sheet.getMaxRows() : sheet.getMaxColumns()
        integer(edit.index, 0, size - 1, 'structural edit index')
        integer(edit.count, 1, 10_000, 'structural edit count')
        requireEdit(insert ? size + edit.count <= (rows ? 1_048_576 : 16_384) : edit.index + edit.count <= size && edit.count < size, 'Structural edit exceeds sheet dimensions.')
        if (edit.type === 'insertRows') sheet.insertRows(edit.index, edit.count)
        else if (edit.type === 'deleteRows') sheet.deleteRows(edit.index, edit.count)
        else if (edit.type === 'insertColumns') sheet.insertColumns(edit.index, edit.count)
        else sheet.deleteColumns(edit.index, edit.count)
      } else {
        requireEdit(['setCells', 'setFormulas', 'clearRange', 'formatRange'].includes(edit.type), 'Unknown spreadsheet edit.')
        const rangeEdit = edit
        validateRange(rangeEdit, sheet.getMaxRows(), sheet.getMaxColumns())
        const range = sheet.getRange(rangeEdit.row, rangeEdit.column, rangeEdit.rows, rangeEdit.columns)
        if (rangeEdit.type === 'clearRange') range.clear({ contentsOnly: true })
        else if (rangeEdit.type === 'formatRange') format(sheet, rangeEdit)
        else {
          const values = rangeEdit.type === 'setCells' ? rangeEdit.values : rangeEdit.formulas
          requireEdit(Array.isArray(values) && values.length === rangeEdit.rows && values.every((row) => Array.isArray(row) && row.length === rangeEdit.columns), 'Values must match range dimensions.')
          const cells: ICellData[][] = values.map((row) => row.map((value) => {
            if (rangeEdit.type === 'setFormulas') {
              requireEdit(typeof value === 'string' && value.startsWith('=') && value.length > 1 && value.length <= 10_000, 'Formulas must start with =.')
              return { f: value, v: null, p: null, t: null }
            }
            requireEdit(value === null || typeof value === 'boolean' || typeof value === 'string' && value.length <= 10_000 || typeof value === 'number' && Number.isFinite(value), 'Invalid cell value.')
            // Explicit cell types preserve identifiers and strings beginning with = as literal text.
            return { v: value, f: null, p: null, t: typeof value === 'string' ? 1 : typeof value === 'number' ? 2 : typeof value === 'boolean' ? 3 : null }
          }))
          range.setValues(cells)
        }
      }
    }
    const result: SpreadsheetContent = { format: 'univer', kind: 'SPREADSHEET', snapshot: preserveResources(snapshot, workbook.save()) }
    contentSnapshot('SPREADSHEET', result)
    return result
  } finally { runtime.dispose() }
}

type Args<T extends SpreadsheetEdit['type']> = Omit<Extract<SpreadsheetEdit, { type: T }>, 'type'>
export const setCells = (content: unknown, edit: Args<'setCells'>) => applySpreadsheetEdits(content, [{ ...edit, type: 'setCells' }])
export const setFormulas = (content: unknown, edit: Args<'setFormulas'>) => applySpreadsheetEdits(content, [{ ...edit, type: 'setFormulas' }])
export const clearRange = (content: unknown, edit: Args<'clearRange'>) => applySpreadsheetEdits(content, [{ ...edit, type: 'clearRange' }])
export const formatRange = (content: unknown, edit: Args<'formatRange'>) => applySpreadsheetEdits(content, [{ ...edit, type: 'formatRange' }])
export const insertRows = (content: unknown, edit: Args<'insertRows'>) => applySpreadsheetEdits(content, [{ ...edit, type: 'insertRows' }])
export const deleteRows = (content: unknown, edit: Args<'deleteRows'>) => applySpreadsheetEdits(content, [{ ...edit, type: 'deleteRows' }])
export const insertColumns = (content: unknown, edit: Args<'insertColumns'>) => applySpreadsheetEdits(content, [{ ...edit, type: 'insertColumns' }])
export const deleteColumns = (content: unknown, edit: Args<'deleteColumns'>) => applySpreadsheetEdits(content, [{ ...edit, type: 'deleteColumns' }])
export const addSheet = (content: unknown, edit: Args<'addSheet'>) => applySpreadsheetEdits(content, [{ ...edit, type: 'addSheet' }])
export const renameSheet = (content: unknown, edit: Args<'renameSheet'>) => applySpreadsheetEdits(content, [{ ...edit, type: 'renameSheet' }])
export const deleteSheet = (content: unknown, edit: Args<'deleteSheet'>) => applySpreadsheetEdits(content, [{ ...edit, type: 'deleteSheet' }])
