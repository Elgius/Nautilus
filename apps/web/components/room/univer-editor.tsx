'use client';

import dynamic from 'next/dynamic';
import type { OfficeContent } from '@/lib/office-content';
import type { OfficeEditorProps } from './univer-editor-core';
export type { OfficeEditorHandle } from './univer-editor-core';

const loadDocumentEditor = () => import('./univer-document-editor');
const loadSpreadsheetEditor = () => import('./univer-spreadsheet-editor');
const loading = () => <p role="status" className="p-6 text-sm">Loading editor…</p>;
const DocumentEditor = dynamic(loadDocumentEditor, { ssr: false, loading });
const SpreadsheetEditor = dynamic(loadSpreadsheetEditor, { ssr: false, loading });

export function preloadOfficeEditor(kind: OfficeContent['kind']) {
  return kind === 'DOCUMENT' ? loadDocumentEditor() : loadSpreadsheetEditor();
}

export default function UniverEditor(props: OfficeEditorProps) {
  return props.initialContent.kind === 'DOCUMENT' ? <DocumentEditor {...props} /> : <SpreadsheetEditor {...props} />;
}
