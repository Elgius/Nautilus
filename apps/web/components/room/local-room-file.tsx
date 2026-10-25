'use client';

import { useEffect, useState } from 'react';
import { Download, FileText, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { downloadBlob } from '@/lib/office-content';
import { localPreviewType, type LocalRoomFile } from '@/lib/local-room-files';

export function LocalRoomFilePreview({ entry, onRemove }: { entry: LocalRoomFile; onRemove: () => void }) {
  const { file } = entry;
  const kind = localPreviewType(file);
  const [preview, setPreview] = useState<{ url?: string; text?: string; error?: string }>({});
  useEffect(() => {
    let active = true;
    if (kind === 'text') {
      // Bound the rendered preview without changing the retained original file.
      file.slice(0, 200_000).text().then((text) => { if (active) setPreview({ text }); })
        .catch(() => { if (active) setPreview({ error: 'Couldn’t preview this file. You can still download the original.' }); });
      return () => { active = false; };
    }
    if (kind === 'image' || kind === 'pdf') {
      let url: string | undefined;
      file.arrayBuffer().then((buffer) => {
        if (!active) return;
        url = URL.createObjectURL(new Blob([buffer], { type: file.type || 'application/pdf' }));
        setPreview({ url });
      }).catch(() => { if (active) setPreview({ error: 'Couldn’t preview this file. You can still download the original.' }); });
      return () => { active = false; if (url) URL.revokeObjectURL(url); };
    }
  }, [file, kind]);
  return <section className="flex min-h-0 flex-1 flex-col overflow-auto" aria-label={`Local file ${file.name}`}>
    <div className="room-panel-heading flex-wrap gap-2"><div className="min-w-0"><FileText size={16} /><h2 className="break-all">{file.name}</h2><span className="room-document-status">Local file</span></div>
      <div className="flex gap-1"><Button variant="outline" size="sm" onClick={() => downloadBlob(file, file.name)}><Download size={14} />Download original</Button>
        <Button variant="ghost" size="icon-sm" aria-label={`Remove ${file.name} from this tab`} onClick={onRemove}><Trash2 size={15} /></Button></div>
    </div>
    <p className="border-b px-4 py-3 text-xs text-muted-foreground" role="status">{(file.size / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 })} KB · Kept in this browser tab. Not uploaded to cloud storage. Leaving or refreshing this room clears local files.</p>
    {preview.error && <p role="alert" className="p-4 text-sm text-destructive">{preview.error}</p>}
    {kind === 'text' && preview.text !== undefined && <div className="min-h-0 flex-1 overflow-auto p-5"><pre className="whitespace-pre-wrap break-words font-mono text-sm" aria-label="Local file preview">{preview.text}</pre>{file.size > 200_000 && <p className="mt-3 text-xs text-muted-foreground">Preview shows the first 200 KB. Download the original for the complete file.</p>}</div>}
    {/* Raster-only previews: active HTML/SVG files are never embedded. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    {kind === 'image' && preview.url && <img src={preview.url} alt={file.name} className="max-h-full max-w-full object-contain p-4" />}
    {kind === 'pdf' && preview.url && <iframe src={preview.url} title={`PDF preview: ${file.name}`} sandbox="" className="min-h-96 flex-1 border-0" />}
    {kind === 'download' && <div className="p-6 text-sm text-muted-foreground"><p>This file is available in your browser. An inline preview is not available for this format.</p><p className="mt-2">Download the original to open it in its desktop app.</p></div>}
    {((kind === 'text' && preview.text === undefined) || ((kind === 'image' || kind === 'pdf') && !preview.url)) && !preview.error && <p role="status" className="p-5 text-sm">Loading local preview…</p>}
  </section>;
}
