/** Semantic inputs shared by the agent contract and Office executor. */
export type FontStyle = {
  fontFamily?: string; fontSize?: number; bold?: boolean; italic?: boolean;
  color?: string;
}
export type InsertTableEdit = {
  type: 'insertTable'; index: number; cells: string[][];
  headerRow?: boolean; columnWidths?: number[];
}
export type SetTableCellEdit = {
  type: 'setTableCell'; tableId: string; row: number; column: number;
  expectedText: string; text: string;
}
export type FormatFontEdit = {
  type: 'formatFont'; start: number; end: number; segmentId?: string; style: FontStyle;
}
