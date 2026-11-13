'use client';

import { createUniver, LocaleType } from '@univerjs/presets';
import { DocSkeletonManagerService, Documents, IRenderManagerService, getTextRangeFromCharIndex, UniverDocsCorePreset } from '@univerjs/preset-docs-core';
import DocsEnUS from '@univerjs/preset-docs-core/locales/en-US';
import UniverEditorCore, { type OfficeEditorProps, type StreamCursor } from './univer-editor-core';
import '@univerjs/preset-docs-core/lib/index.css';

const createEditor = (container: HTMLDivElement) => {
  const editor = createUniver({
    locale: LocaleType.EN_US,
    locales: { [LocaleType.EN_US]: DocsEnUS },
    presets: [UniverDocsCorePreset({ container, header: true, toolbar: true, disableAutoFocus: true })],
  });
  let frame: number | null = null;
  let cursor: StreamCursor | null = null;
  let overlay: HTMLDivElement | null = null;
  let marker: HTMLDivElement | null = null;
  const draw = () => {
    frame = null;
    if (!cursor || !marker || !overlay) return;
    marker.hidden = true;
    const doc = editor.univerAPI.getActiveDocument();
    const render = doc && editor.univer.__getInjector().get(IRenderManagerService).getRenderUnitById(doc.id);
    if (render && render.mainComponent instanceof Documents) {
      const skeleton = render.with(DocSkeletonManagerService).getSkeleton();
      // A separate range never changes the local user's selection or focus.
      const range = getTextRangeFromCharIndex(cursor.offset, cursor.offset, render.scene, render.mainComponent, skeleton, { strokeWidth: 0, stroke: 'transparent', strokeActive: 'transparent', fill: 'transparent' }, '', -1);
      const position = range?.getAbsolutePosition();
      range?.dispose();
      if (position) {
        const canvas = render.engine.getCanvasElement().getBoundingClientRect();
        const host = container.getBoundingClientRect();
        const viewport = render.scene.getDefaultViewport();
        // Match the renderer's clip bounds; the host also includes the toolbar.
        const viewportLeft = canvas.left - host.left + viewport.left;
        const viewportTop = canvas.top - host.top + viewport.top;
        const width = viewport.width ?? 0;
        const viewportHeight = viewport.height ?? 0;
        Object.assign(overlay.style, { left: `${viewportLeft}px`, top: `${viewportTop}px`, width: `${width}px`, height: `${viewportHeight}px` });
        const left = canvas.left - host.left + position.left * render.scene.ancestorScaleX - viewport.viewportScrollX;
        const top = canvas.top - host.top + position.top * render.scene.ancestorScaleY - viewport.viewportScrollY;
        const height = Math.max(16, position.height * render.scene.ancestorScaleY);
        if (left >= viewportLeft && left < viewportLeft + width && top + height > viewportTop && top < viewportTop + viewportHeight) {
          marker.hidden = false;
          marker.style.left = `${left - viewportLeft}px`;
          marker.style.top = `${top - viewportTop}px`;
          marker.style.height = `${height}px`;
        }
      }
    }
    frame = requestAnimationFrame(draw);
  };
  return { ...editor, streamCursor: (next: StreamCursor | null) => {
    cursor = next;
    if (!next) {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      marker?.remove(); marker = null;
      overlay?.remove(); overlay = null;
      return;
    }
    if (!marker) {
      overlay = document.createElement('div');
      overlay.className = 'document-stream-overlay';
      marker = document.createElement('div');
      marker.className = 'document-stream-cursor';
      marker.setAttribute('role', 'status');
      marker.append(document.createElement('span'));
      overlay.append(marker);
      container.append(overlay);
    }
    marker.style.color = next.color;
    marker.style.setProperty('--stream-cursor-color', next.color);
    if (marker.firstChild?.textContent !== next.label) marker.firstChild!.textContent = next.label;
    if (frame === null) frame = requestAnimationFrame(draw);
  } };
};

export default function UniverDocumentEditor(props: OfficeEditorProps) {
  return <UniverEditorCore {...props} createEditor={createEditor} />;
}
