import type { IDocumentData, IWorkbookData, IWorksheetData, ICellData } from '@univerjs/presets';

export type OfficeContent =
  | { format: 'univer'; kind: 'DOCUMENT'; snapshot: IDocumentData }
  | { format: 'univer'; kind: 'SPREADSHEET'; snapshot: IWorkbookData };
export type LegacyContent = { format: 'markdown'; text: string } | {
  format: 'spreadsheet'; sheets: { id: number; name: string; cells: string[][] }[];
  styles: Record<string, { bold?: boolean; italic?: boolean }>;
};

// Type-only SDK imports keep the browser editor out of server and migration bundles.
export function officeContent(kind: OfficeContent['kind'], id: string, title: string, saved?: OfficeContent | LegacyContent | null): OfficeContent {
  if (saved?.format === 'univer') {
    if (saved.kind !== kind) throw new Error('The saved file has the wrong document type.');
    return saved;
  }
  if (kind === 'DOCUMENT') {
    if (saved && saved.format !== 'markdown') throw new Error('The saved file is not a document.');
    const dataStream = (saved?.text ?? '').replace(/\r\n|\r|\n/g, '\r') + '\r\n';
    return { format: 'univer', kind, snapshot: { id, title, documentStyle: {
      documentFlavor: 1, pageSize: { width: 794, height: 1123 },
      marginTop: 72, marginBottom: 72, marginLeft: 72, marginRight: 72,
    }, body: {
      dataStream,
      paragraphs: Array.from(dataStream.matchAll(/\r/g), (match, index) => ({ startIndex: match.index!, paragraphId: `paragraph-${index}` })),
    } } };
  }
  if (saved && saved.format !== 'spreadsheet') throw new Error('The saved file is not a spreadsheet.');
  const sheets: Record<string, Partial<IWorksheetData>> = {};
  for (const sheet of saved?.sheets ?? [{ id: 1, name: 'Sheet 1', cells: [] }]) {
    const cellData: Record<number, Record<number, ICellData>> = {};
    sheet.cells.forEach((row, rowIndex) => row.forEach((value, columnIndex) => {
      const style = saved?.styles[`${sheet.id}:${rowIndex}:${columnIndex}`];
      if (!value && !style) return;
      // Keep identifiers such as 00123, decimal display precision and large
      // integers as text rather than silently changing legacy cell contents.
      const number = Number(value);
      const numeric = value !== '' && Number.isFinite(number) && String(number) === value &&
        (!Number.isInteger(number) || Number.isSafeInteger(number));
      const cell: ICellData = value.startsWith('=') ? { f: value } : numeric ? { v: number, t: 2 } : { v: value, t: 1 };
      if (style) cell.s = { bl: style.bold ? 1 : 0, it: style.italic ? 1 : 0 };
      (cellData[rowIndex] ??= {})[columnIndex] = cell;
    }));
    sheets[String(sheet.id)] = { id: String(sheet.id), name: sheet.name, rowCount: Math.max(100, sheet.cells.length), columnCount: 26, cellData };
  }
  return { format: 'univer', kind, snapshot: {
    id, name: title, appVersion: '1.2.0', locale: 'enUS' as IWorkbookData['locale'],
    styles: {}, sheetOrder: Object.keys(sheets), sheets,
  } };
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = name; link.click();
  // Let the browser start the download before releasing its object URL.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
