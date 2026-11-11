'use client';

import { createUniver, LocaleType, mergeLocales } from '@univerjs/presets';
import { UniverSheetsCorePreset } from '@univerjs/preset-sheets-core';
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
import '@univerjs/preset-sheets-core/lib/index.css';
import '@univerjs/preset-sheets-filter/lib/index.css';
import '@univerjs/preset-sheets-sort/lib/index.css';
import '@univerjs/preset-sheets-data-validation/lib/index.css';
import '@univerjs/preset-sheets-conditional-formatting/lib/index.css';

const createEditor = (container: HTMLDivElement) => createUniver({
  locale: LocaleType.EN_US,
  locales: { [LocaleType.EN_US]: mergeLocales(SheetsEnUS, FilterEnUS, SortEnUS, ValidationEnUS, FormattingEnUS) },
  presets: [
    UniverSheetsCorePreset({ container, header: true, toolbar: true, disableAutoFocus: true }),
    UniverSheetsFilterPreset(), UniverSheetsSortPreset(), UniverSheetsDataValidationPreset(), UniverSheetsConditionalFormattingPreset(),
  ],
});

export default function UniverSpreadsheetEditor(props: OfficeEditorProps) {
  return <UniverEditorCore {...props} createEditor={createEditor} />;
}
