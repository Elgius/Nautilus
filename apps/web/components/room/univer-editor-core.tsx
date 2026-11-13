'use client';

import { useEffect, useEffectEvent, useRef } from 'react';
import { CommandType, type createUniver } from '@univerjs/presets';
import { belongsToOfficeUnit } from '@/lib/office-mutations';
import type { OfficeContent } from '@/lib/office-content';
import { updateUniverDocument } from '@/lib/univer-document-update';
import './univer-editor.css';

export type StreamCursor = { offset: number; label: string; color: string };

export type OfficeEditorHandle = {
  streamCursor?: (cursor: StreamCursor | null) => void;
  snapshot: () => Promise<OfficeContent>;
  updateContent?: (content: OfficeContent, preview?: boolean) => boolean;
};

export type OfficeEditorProps = {
  initialContent: OfficeContent;
  onReady: (handle: OfficeEditorHandle | null) => void;
  onDirty: () => void;
  onError: (message: string) => void;
  onSuspend: (snapshot: OfficeContent, source: OfficeContent) => void;
  readOnly?: boolean;
};

type EditorFactory = (container: HTMLDivElement) => ReturnType<typeof createUniver> & { streamCursor?: (cursor: StreamCursor | null) => void };

export default function UniverEditorCore({ initialContent, onReady, onDirty, onError, onSuspend, readOnly = false, createEditor }: OfficeEditorProps & { createEditor: EditorFactory }) {
  const container = useRef<HTMLDivElement>(null);
  const permission = useRef<((value: boolean) => Promise<void>) | null>(null);
  const currentReadOnly = useEffectEvent(() => readOnly);
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
    const { univer, univerAPI, streamCursor } = createEditor(mount);
    let subscription: { dispose: () => void } | undefined;
    let applyingRemote = false;
    let previewing = false;
    let savedContent = initialContent;
    try {
      if (initialContent.kind === 'DOCUMENT') univerAPI.createDocument(structuredClone(initialContent.snapshot));
      else univerAPI.createWorkbook(structuredClone(initialContent.snapshot));
      permission.current = async (value) => {
        if (value && container.current?.contains(document.activeElement)) (document.activeElement as HTMLElement)?.blur();
        if (isDoc) await univerAPI.getActiveDocument()?.getPermission().setEditable(!value);
        else univerAPI.getActiveWorkbook()?.setEditable(!value);
      };
      void permission.current(currentReadOnly()).catch(() => reportError('Could not update editor permissions. Reload this document.'));
      ready({ streamCursor, updateContent: (next, preview = false) => {
        if (!isDoc) return false;
        applyingRemote = true;
        try {
          if (preview && !previewing) savedContent = { format: 'univer', kind: 'DOCUMENT', snapshot: structuredClone(univerAPI.getActiveDocument()!.save()) };
          if (!updateUniverDocument(univerAPI, next)) return false;
          previewing = preview;
          if (!preview) savedContent = next;
          return true;
        } finally { applyingRemote = false; }
      }, snapshot: async () => {
        // Unreviewed previews are never exported, saved, or retained as drafts.
        if (previewing) return structuredClone(savedContent);
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
        if (!applyingRemote && event.type === CommandType.MUTATION && !event.id.startsWith('formula.') && !event.options?.applyFormulaCalculationResult && belongsToOfficeUnit(event.params, initialContent.snapshot.id)) dirty();
      });
    } catch (error) {
      reportError(error instanceof Error ? error.message : 'Could not open the editor.');
    }
    return () => {
      // Retain a draft when its tab is hidden, while releasing global keyboard
      // handlers so that only the visible editor receives input.
      const document = isDoc ? univerAPI.getActiveDocument() : null;
      const workbook = !isDoc ? univerAPI.getActiveWorkbook() : null;
      if (document) suspend(previewing ? structuredClone(savedContent) : { format: 'univer', kind: 'DOCUMENT', snapshot: structuredClone(document.save()) }, initialContent);
      if (workbook) suspend({ format: 'univer', kind: 'SPREADSHEET', snapshot: structuredClone(workbook.save()) }, initialContent);
      streamCursor?.(null);
      subscription?.dispose(); ready(null); mount.remove();
      permission.current = null;
      // Univer owns a separate React root. Dispose after the host's commit.
      queueMicrotask(() => univer.dispose());
    };
  }, [initialContent, createEditor]);
  useEffect(() => {
    void permission.current?.(readOnly).catch(() => reportError('Could not update editor permissions. Reload this document.'));
  }, [readOnly]);
  return <div ref={container} inert={readOnly} className="nautilus-office-editor" aria-label={initialContent.kind === 'DOCUMENT' ? 'Word document editor' : 'Spreadsheet editor'} />;
}
