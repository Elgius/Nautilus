'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Download, FileText, Trash2, Info, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { downloadBlob } from '@/lib/office-content';
import { localPreviewType, type LocalRoomFile } from '@/lib/local-room-files';

export function LocalRoomFilePreview({ entry, onRemove, active, actionsContainer }: { entry: LocalRoomFile; onRemove: () => void; active: boolean; actionsContainer: HTMLDivElement | null }) {
  const { file } = entry;
  const [detailsOpen, setDetailsOpen] = useState(false);
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
    {active && actionsContainer && createPortal(<div className="room-document-toolbar">
      <div className="room-active-file"><FileText size={15} /><strong title={file.name}>{file.name}</strong></div>
      <Button variant="ghost" size="sm" className="room-local-badge" onClick={() => setDetailsOpen(true)} aria-label="Local file details"><Info size={13} />Local file</Button>
      <DropdownMenu><DropdownMenuTrigger render={<Button variant="ghost" size="sm" />} aria-label="File menu">File<ChevronDown size={12} /></DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-48">
          <DropdownMenuItem onClick={() => downloadBlob(file, file.name)}><Download size={14} />Download original</DropdownMenuItem>
          <DropdownMenuItem onClick={() => setDetailsOpen(true)}><Info size={14} />File details</DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={onRemove}><Trash2 size={14} />Remove local file</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button variant="outline" size="sm" onClick={() => downloadBlob(file, file.name)}><Download size={14} /><span className="room-download-label">Download original</span></Button>
    </div>, actionsContainer)}
    <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}><DialogContent><DialogHeader><DialogTitle>Local file details</DialogTitle><DialogDescription>This file stays in this browser tab. It is not saved to the room or uploaded to cloud storage.</DialogDescription></DialogHeader>
      <p className="break-all font-medium">{file.name}</p><p className="text-sm text-muted-foreground">{file.size.toLocaleString()} bytes · {file.type || 'Unknown file type'}</p>
      <p className="text-sm text-muted-foreground">Closing its tab keeps it in Files. Leaving or refreshing this room clears local files.</p>
    </DialogContent></Dialog>
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
