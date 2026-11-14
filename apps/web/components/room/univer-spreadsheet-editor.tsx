'use client';

import { createUniver, LocaleType, mergeLocales } from '@univerjs/presets';
import { SheetsSelectionsService, UniverSheetsCorePreset } from '@univerjs/preset-sheets-core';
import SheetsEnUS from '@univerjs/preset-sheets-core/locales/en-US';
import { UniverSheetsFilterPreset } from '@univerjs/preset-sheets-filter';
import FilterEnUS from '@univerjs/preset-sheets-filter/locales/en-US';
import { UniverSheetsSortPreset } from '@univerjs/preset-sheets-sort';
import SortEnUS from '@univerjs/preset-sheets-sort/locales/en-US';
import { UniverSheetsDataValidationPreset } from '@univerjs/preset-sheets-data-validation';
import ValidationEnUS from '@univerjs/preset-sheets-data-validation/locales/en-US';
import { UniverSheetsConditionalFormattingPreset } from '@univerjs/preset-sheets-conditional-formatting';
import FormattingEnUS from '@univerjs/preset-sheets-conditional-formatting/locales/en-US';
import UniverEditorCore, { type OfficeEditorProps } from './univer-editor-core';
import { MAX_SELECTION_TEXT, type OfficeSelection } from '@/lib/document-selection';
import '@univerjs/preset-sheets-core/lib/index.css';
import '@univerjs/preset-sheets-filter/lib/index.css';
import '@univerjs/preset-sheets-sort/lib/index.css';
import '@univerjs/preset-sheets-data-validation/lib/index.css';
import '@univerjs/preset-sheets-conditional-formatting/lib/index.css';

const createEditor = (container: HTMLDivElement) => {
  const editor = createUniver({
    locale: LocaleType.EN_US,
    locales: { [LocaleType.EN_US]: mergeLocales(SheetsEnUS, FilterEnUS, SortEnUS, ValidationEnUS, FormattingEnUS) },
    presets: [
      UniverSheetsCorePreset({ container, header: true, toolbar: true, disableAutoFocus: true }),
      UniverSheetsFilterPreset(), UniverSheetsSortPreset(), UniverSheetsDataValidationPreset(), UniverSheetsConditionalFormattingPreset(),
    ],
  });
  return { ...editor, observeSelection: (notify: (selection: OfficeSelection) => void) => {
    const selections = editor.univer.__getInjector().get(SheetsSelectionsService);
    let interacted = false;
    const beginSelection = () => { interacted = true; };
    const captureSelection = () => {
      if (!interacted) return;
      const worksheet = editor.univerAPI.getActiveWorkbook()?.getActiveSheet();
      const range = worksheet?.getActiveRange();
      if (!range || !worksheet) return;
      const { startRow, endRow, startColumn, endColumn } = range.getRange();
      // Bound work before reading values, including whole-column/whole-sheet selections.
      const rows = Math.min(endRow - startRow + 1, 100);
      const columns = Math.min(endColumn - startColumn + 1, 20);
      const values = worksheet.getRange(startRow, startColumn, rows, columns).getDisplayValues();
      const text = values.map((row) => row.join('\t')).join('\n');
      if (!text.trim()) return;
      notify({ text: text.slice(0, MAX_SELECTION_TEXT), location: `${range.getSheetName()}!${range.getA1Notation()}`, truncated: rows < endRow - startRow + 1 || columns < endColumn - startColumn + 1 || text.length > MAX_SELECTION_TEXT });
    };
    container.addEventListener('pointerdown', beginSelection, true);
    container.addEventListener('keydown', beginSelection, true);
    container.addEventListener('pointerup', captureSelection);
    const subscription = selections.selectionChanged$.subscribe(captureSelection);
    return { dispose: () => {
      subscription.unsubscribe();
      container.removeEventListener('pointerdown', beginSelection, true);
      container.removeEventListener('keydown', beginSelection, true);
      container.removeEventListener('pointerup', captureSelection);
    } };
  } };
};

export default function UniverSpreadsheetEditor(props: OfficeEditorProps) {
  return <UniverEditorCore {...props} createEditor={createEditor} />;
}
