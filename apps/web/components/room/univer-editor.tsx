'use client';

import { useEffect, useEffectEvent, useRef } from 'react';
import { createUniver, CommandType, LocaleType, mergeLocales } from '@univerjs/presets';
import { UniverDocsCorePreset } from '@univerjs/preset-docs-core';
import DocsEnUS from '@univerjs/preset-docs-core/locales/en-US';
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
import type { OfficeContent } from '@/lib/office-content';
import '@univerjs/preset-docs-core/lib/index.css';
import '@univerjs/preset-sheets-core/lib/index.css';
import '@univerjs/preset-sheets-filter/lib/index.css';
import '@univerjs/preset-sheets-sort/lib/index.css';
import '@univerjs/preset-sheets-data-validation/lib/index.css';
import '@univerjs/preset-sheets-conditional-formatting/lib/index.css';
import './univer-editor.css';

export type OfficeEditorHandle = { snapshot: () => Promise<OfficeContent> };

export default function UniverEditor({ initialContent, onReady, onDirty, onError, onSuspend }: {
  initialContent: OfficeContent;
  onReady: (handle: OfficeEditorHandle | null) => void;
  onDirty: () => void;
  onError: (message: string) => void;
  onSuspend: (snapshot: OfficeContent, source: OfficeContent) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const ready = useEffectEvent(onReady);
  const dirty = useEffectEvent(onDirty);
  const reportError = useEffectEvent(onError);
  const suspend = useEffectEvent(onSuspend);
  useEffect(() => {
    if (!container.current) return;
    const mount = document.createElement('div');
    mount.style.height = '100%';
    container.current.append(mount);
    const isDoc = initialContent.kind === 'DOCUMENT';
    const { univer, univerAPI } = createUniver({
      locale: LocaleType.EN_US,
      locales: { [LocaleType.EN_US]: mergeLocales(DocsEnUS, SheetsEnUS, FilterEnUS, SortEnUS, ValidationEnUS, FormattingEnUS) },
      presets: isDoc ? [UniverDocsCorePreset({ container: mount, header: true, toolbar: true, disableAutoFocus: true })] : [
        UniverSheetsCorePreset({ container: mount, header: true, toolbar: true, disableAutoFocus: true }),
        UniverSheetsFilterPreset(), UniverSheetsSortPreset(), UniverSheetsDataValidationPreset(), UniverSheetsConditionalFormattingPreset(),
      ],
    });
    let subscription: { dispose: () => void } | undefined;
    try {
      if (initialContent.kind === 'DOCUMENT') univerAPI.createDocument(structuredClone(initialContent.snapshot));
      else univerAPI.createWorkbook(structuredClone(initialContent.snapshot));
      ready({ snapshot: async () => {
        // Read at save/export time, including the latest committed cell editor value.
        container.current?.querySelector<HTMLElement>(':focus')?.blur();
        if (isDoc) {
          const document = univerAPI.getActiveDocument();
          if (!document) throw new Error('The document editor is not ready.');
          return { format: 'univer', kind: 'DOCUMENT', snapshot: structuredClone(document.save()) };
        }
        const workbook = univerAPI.getActiveWorkbook();
        if (!workbook) throw new Error('The spreadsheet editor is not ready.');
        await workbook.endEditingAsync(true);
        return { format: 'univer', kind: 'SPREADSHEET', snapshot: structuredClone(workbook.save()) };
      } });
      subscription = univerAPI.addEvent(univerAPI.Event.CommandExecuted, (event) => {
        if (event.type === CommandType.MUTATION && !event.id.startsWith('formula.') && !event.options?.applyFormulaCalculationResult) dirty();
      });
    } catch (error) {
      reportError(error instanceof Error ? error.message : 'Could not open the editor.');
    }
    return () => {
      // Retain a draft when its tab is hidden, while releasing global keyboard
      // handlers so that only the visible editor receives input.
      const document = isDoc ? univerAPI.getActiveDocument() : null;
      const workbook = !isDoc ? univerAPI.getActiveWorkbook() : null;
      if (document) suspend({ format: 'univer', kind: 'DOCUMENT', snapshot: structuredClone(document.save()) }, initialContent);
      if (workbook) suspend({ format: 'univer', kind: 'SPREADSHEET', snapshot: structuredClone(workbook.save()) }, initialContent);
      subscription?.dispose(); ready(null); mount.remove();
      // Univer owns a separate React root. Dispose after the host's commit.
      queueMicrotask(() => univer.dispose());
    };
  }, [initialContent]);
  return <div ref={container} className="nautilus-office-editor" aria-label={initialContent.kind === 'DOCUMENT' ? 'Word document editor' : 'Spreadsheet editor'} />;
}
