'use client';

import { createUniver, LocaleType } from '@univerjs/presets';
import { UniverDocsCorePreset } from '@univerjs/preset-docs-core';
import DocsEnUS from '@univerjs/preset-docs-core/locales/en-US';
import UniverEditorCore, { type OfficeEditorProps } from './univer-editor-core';
import '@univerjs/preset-docs-core/lib/index.css';

const createEditor = (container: HTMLDivElement) => createUniver({
  locale: LocaleType.EN_US,
  locales: { [LocaleType.EN_US]: DocsEnUS },
  presets: [UniverDocsCorePreset({ container, header: true, toolbar: true, disableAutoFocus: true })],
});

export default function UniverDocumentEditor(props: OfficeEditorProps) {
  return <UniverEditorCore {...props} createEditor={createEditor} />;
}
