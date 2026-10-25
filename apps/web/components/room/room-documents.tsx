"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import dynamic from 'next/dynamic';
import { Download, Plus, Save, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from '@/components/ui/input';
import { Dropzone } from '@/components/ui/dropzone';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { errorMessage } from '@/lib/auth-client';
import { roomRequest, type RoomDocument, type DocumentVersion, type DocumentVersionsPage } from '@/lib/room-client';
import { downloadBlob, officeContent, type OfficeContent, type LegacyContent } from '@/lib/office-content';
import type { OfficeEditorHandle } from './univer-editor';
import { addLocalRoomFiles, MAX_LOCAL_FILES, type LocalRoomFile } from '@/lib/local-room-files';
import { LocalRoomFilePreview } from './local-room-file';

const UniverEditor = dynamic(() => import('./univer-editor'), {
  ssr: false, loading: () => <p role="status" className="p-6 text-sm">Loading editor…</p>,
});

export function RoomDocuments({ organizationId, roomId, initialDocuments, storageConfigured, officeConfigured = false, selectedId, onSelect, onDirtyChange }: {
  organizationId: string; roomId: string; initialDocuments: RoomDocument[]; storageConfigured: boolean; officeConfigured?: boolean;
  selectedId?: string; onSelect: (id: string) => void;
  onDirtyChange: (id: string, dirty: boolean) => void;
}) {
  const [documents, setDocuments] = useState(initialDocuments);
  const [localFiles, setLocalFiles] = useState<LocalRoomFile[]>([]);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [visitedIds, setVisitedIds] = useState<string[]>([]);
  const markLoaded = useCallback((id: string) => setVisitedIds((previous) => previous.includes(id) ? previous : [...previous, id]), []);
  const selected = documents.find((document) => document.id === selectedId);
  const selectedLocalFile = localFiles.find((entry) => entry.id === selectedId);
  async function uploadLocalFiles(files: File[]) {
    setUploadError('');
    try {
      const next = addLocalRoomFiles(localFiles, files);
      setLocalFiles(next);
      onSelect(next[localFiles.length].id);
      setUploadOpen(false);
    } catch (error) { setUploadError(errorMessage(error)); }
  }
  function removeLocalFile(id: string) {
    const remaining = localFiles.filter((entry) => entry.id !== id);
    setLocalFiles(remaining);
    if (selectedId === id) onSelect(remaining[0]?.id ?? documents[0]?.id ?? '');
  }
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (creating) return;
    const form = event.currentTarget, data = new FormData(form);
    setCreating(true); setError('');
    try {
      const result = await roomRequest<{ document: RoomDocument }>(organizationId, `/${roomId}/documents`, 'POST', {
        title: String(data.get('title')), kind: String(data.get('kind')),
      });
      setDocuments((previous) => [...previous, result.document]);
      onSelect(result.document.id); form.reset();
    } catch (error) { setError(errorMessage(error)); }
    finally { setCreating(false); }
  }
  return <>
    <div className="room-panel-heading"><h2>Room documents</h2><div className="flex items-center gap-3"><span>{documents.length + localFiles.length} files</span>
      <Button type="button" variant="outline" size="sm" onClick={() => { setUploadError(''); setUploadOpen(true); }} disabled={localFiles.length >= MAX_LOCAL_FILES}><Upload size={14} />Upload files</Button>
    </div></div>
    <p className="room-local-note" role="status">Files from your computer stay in this browser tab. Cloud uploads will be available in a later update.</p>
    <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
      <DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>Upload files from your computer</DialogTitle>
        <DialogDescription>Choose one or more files to open in this tab. They won’t be sent to cloud storage or shared with your room. Leaving or refreshing the room clears these local files.</DialogDescription></DialogHeader>
        <Dropzone description="Documents, PDFs, spreadsheets, images, and other files" maxFiles={MAX_LOCAL_FILES} onFiles={uploadLocalFiles} />
        {uploadError && <p role="alert" className="text-sm text-destructive">{uploadError}</p>}
      </DialogContent>
    </Dialog>
    <form onSubmit={create} className="flex flex-wrap gap-2 border-b p-3" aria-busy={creating}>
      <Input name="title" aria-label="New document title" placeholder="Document title" maxLength={150} required className="min-w-32 flex-1" disabled={creating} />
      <Select name="kind" defaultValue="DOCUMENT" disabled={creating}
        items={[{ value: 'DOCUMENT', label: 'Document' }, { value: 'SPREADSHEET', label: 'Spreadsheet' }]}>
        <SelectTrigger aria-label="Document type"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="DOCUMENT">Document</SelectItem><SelectItem value="SPREADSHEET">Spreadsheet</SelectItem></SelectContent>
      </Select>
      <Button type="submit" size="sm" variant="outline" disabled={creating}><Plus size={14} />{creating ? 'Creating…' : 'Create'}</Button>
    </form>
    {error && <p role="alert" className="p-3 text-sm text-destructive">{error}</p>}
    <div className="flex gap-2 overflow-x-auto border-b p-2" aria-label="Room files">
      {documents.map((document) => <Button key={document.id} variant={selectedId === document.id ? 'secondary' : 'ghost'} size="sm" onClick={() => onSelect(document.id)} aria-pressed={selectedId === document.id}>{document.title}</Button>)}
      {localFiles.map((entry) => <Button key={entry.id} variant={selectedId === entry.id ? 'secondary' : 'ghost'} size="sm" onClick={() => onSelect(entry.id)} aria-pressed={selectedId === entry.id}>{entry.file.name}<span className="text-xs text-muted-foreground">Local</span></Button>)}
    </div>
    {documents.filter((document) => document.id === selectedId || visitedIds.includes(document.id)).map((document) =>
      <div key={document.id} className="min-h-0 flex-1 flex-col" style={{ display: document.id === selectedId ? 'flex' : 'none' }}>
        <RoomDocumentEditor active={document.id === selectedId} organizationId={organizationId} roomId={roomId} document={document} storageConfigured={storageConfigured} officeConfigured={officeConfigured} onLoaded={markLoaded} onDirtyChange={onDirtyChange} />
      </div>)}
    {selectedLocalFile && <LocalRoomFilePreview key={selectedLocalFile.id} entry={selectedLocalFile} onRemove={() => removeLocalFile(selectedLocalFile.id)} />}
    {!selected && !selectedLocalFile && <p className="p-6 text-sm text-muted-foreground">Upload files from your computer, or create a document or spreadsheet.</p>}
  </>;
}

function RoomDocumentEditor({ active, organizationId, roomId, document, storageConfigured, officeConfigured, onLoaded, onDirtyChange }: {
  active: boolean;
  organizationId: string; roomId: string; document: RoomDocument; storageConfigured: boolean; officeConfigured: boolean;
  onLoaded: (id: string) => void;
  onDirtyChange: (id: string, dirty: boolean) => void;
}) {
  const path = `/${encodeURIComponent(roomId)}/documents/${encodeURIComponent(document.id)}`;
  const endpoint = `/api/organizations/${encodeURIComponent(organizationId)}/rooms${path}`;
  const [content, setContent] = useState<OfficeContent | null>(null);
  const [versionId, setVersionId] = useState<string | null>(document.currentVersionId);
  const [versions, setVersions] = useState<DocumentVersion[]>([]);
  const [nextVersionCursor, setNextVersionCursor] = useState<string | null>(null);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false), [dirty, setDirty] = useState(false);
  const [converting, setConverting] = useState(false), [editorReady, setEditorReady] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false), [notice, setNotice] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const editor = useRef<OfficeEditorHandle | null>(null);
  const revision = useRef(0);
  const onReady = useCallback((handle: OfficeEditorHandle | null) => { editor.current = handle; setEditorReady(!!handle); }, []);
  const onDirty = useCallback(() => { revision.current++; setDirty(true); setNotice(''); }, []);
  useEffect(() => {
    let active = true;
    Promise.all([
      roomRequest<{ content: OfficeContent | LegacyContent | null; currentVersionId: string | null }>(organizationId, `${path}/content`),
      roomRequest<DocumentVersionsPage>(organizationId, `${path}/versions`),
    ]).then(([saved, history]) => {
      if (!active) return;
      setContent(officeContent(document.kind, document.id, document.title, saved.content));
      setVersionId(saved.currentVersionId); setVersions(history.versions); setNextVersionCursor(history.nextCursor); onLoaded(document.id);
    }).catch((error) => { if (active) setError(errorMessage(error)); });
    return () => { active = false; };
  }, [organizationId, path, document.id, document.kind, document.title, onLoaded]);
  useEffect(() => {
    onDirtyChange(document.id, dirty);
    return () => onDirtyChange(document.id, false);
  }, [document.id, dirty, onDirtyChange]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  async function save() {
    if (saving || !editor.current) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const snapshot = await editor.current.snapshot(), savedRevision = revision.current;
      const { version } = await roomRequest<{ version: DocumentVersion }>(organizationId, `${path}/versions`, 'POST', {
        expectedVersionId: versionId, content: snapshot,
      });
      setVersionId(version.id); setVersions((previous) => [version, ...previous]);
      if (revision.current === savedRevision) { setDirty(false); setNotice('Version saved.'); }
    } catch (error) { setError(errorMessage(error)); }
    finally { setSaving(false); }
  }
  async function loadOlderVersions() {
    if (!nextVersionCursor || loadingVersions) return;
    setLoadingVersions(true); setError('');
    try {
      const page = await roomRequest<DocumentVersionsPage>(organizationId, `${path}/versions?before=${encodeURIComponent(nextVersionCursor)}`);
      setVersions((previous) => [...previous, ...page.versions.filter((version) => !previous.some((item) => item.id === version.id))]);
      setNextVersionCursor(page.nextCursor);
    } catch (error) { setError(errorMessage(error)); }
    finally { setLoadingVersions(false); }
  }
  async function checkResponse(response: Response) {
    if (!response.ok) {
      const result = await response.json().catch(() => null);
      throw new Error(result?.error || 'Could not convert this file. Please try again.');
    }
    return response;
  }
  async function importFile(file: File) {
    if (converting || saving) return;
    if (file.size > 10 * 1024 * 1024) { setError('Choose a file up to 10 MB.'); return; }
    if (dirty && !window.confirm('Replace the unsaved contents with this file? Saved versions will remain in History.')) return;
    setConverting(true); setError(''); setNotice('');
    try {
      const form = new FormData(); form.set('file', file);
      const response = await checkResponse(await fetch(`${endpoint}/import`, { method: 'POST', credentials: 'include', body: form }));
      const result = await response.json() as { content: OfficeContent };
      setContent(officeContent(document.kind, document.id, document.title, result.content));
      onDirty(); setNotice(`${file.name} opened. Save to keep it in this room.`); setImportOpen(false);
    } catch (error) { setError(errorMessage(error)); }
    finally { setConverting(false); }
  }
  async function exportFile() {
    if (!editor.current || converting) return;
    setConverting(true); setError('');
    try {
      const response = await checkResponse(await fetch(`${endpoint}/export`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(await editor.current.snapshot()),
      }));
      downloadBlob(await response.blob(), `${document.title.replace(/[\\/:*?"<>|]/g, '-')}.${document.kind === 'DOCUMENT' ? 'docx' : 'xlsx'}`);
      setNotice(`${document.kind === 'DOCUMENT' ? 'Word document' : 'Excel workbook'} downloaded.`);
    } catch (error) { setError(errorMessage(error)); }
    finally { setConverting(false); }
  }
  async function download(id: string) {
    setError('');
    try {
      const { url } = await roomRequest<{ url: string }>(organizationId, `${path}/versions/${encodeURIComponent(id)}/url`);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (error) { setError(errorMessage(error)); }
  }
  const isDoc = document.kind === 'DOCUMENT';
  return <div className="flex min-h-0 flex-1 flex-col overflow-auto">
    <div className="room-panel-heading room-document-toolbar"><div><h2>{document.title}</h2><span className="room-document-status" role="status">{dirty ? 'Unsaved changes' : versionId ? 'Saved' : 'Draft'}</span></div>
      <div className="flex flex-wrap items-center gap-1">
        <Button variant="ghost" size="sm" onClick={() => setHistoryOpen(!historyOpen)} aria-expanded={historyOpen}>History ({versions.length}{nextVersionCursor ? '+' : ''})</Button>
        <Button variant="outline" size="sm" onClick={() => setImportOpen(true)} disabled={!officeConfigured || !editorReady || converting || saving}><Upload size={14} />Import {isDoc ? 'Word' : 'Excel'}</Button>
        <Button variant="outline" size="sm" onClick={exportFile} disabled={!officeConfigured || !editorReady || converting || saving}><Download size={14} />Export {isDoc ? '.docx' : '.xlsx'}</Button>
        <Button size="sm" onClick={save} disabled={saving || converting || !editorReady || !storageConfigured || (!dirty && !!versionId)}><Save size={14} />{saving ? 'Saving…' : 'Save'}</Button>
      </div>
    </div>
    <Dialog open={importOpen} onOpenChange={(open) => { if (!converting) setImportOpen(open); }}>
      <DialogContent showCloseButton={!converting} className="sm:max-w-lg">
        <DialogHeader><DialogTitle>Import {isDoc ? 'a Word document' : 'a spreadsheet'}</DialogTitle>
          <DialogDescription>Open a file in this editor. Import replaces its current contents; saved versions remain in History.</DialogDescription></DialogHeader>
        <Dropzone busy={converting} disabled={saving} description={isDoc ? 'Word files (.doc, .docx)' : 'Excel or text files (.xls, .xlsx, .csv, .tsv)'}
          accept={isDoc ? { 'application/msword': ['.doc'], 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'] } : {
            'application/vnd.ms-excel': ['.xls'], 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'], 'text/csv': ['.csv'], 'text/tab-separated-values': ['.tsv'],
          }} onFile={importFile} />
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
    {!storageConfigured && <p className="p-2 text-xs text-muted-foreground" role="status">Saving to this room is not available yet. Export your work before leaving or refreshing this page.</p>}
    {!officeConfigured && <p className="p-2 text-xs text-muted-foreground" role="status">Editing is available. Word and Excel import/export will be available when the Office conversion service is connected.</p>}
    {error && <p role="alert" className="p-3 text-sm text-destructive">{error}</p>}
    {notice && <p role="status" className="p-2 text-sm text-muted-foreground">{notice}</p>}
    {converting && <p role="status" className="p-2 text-sm">Converting file…</p>}
    {historyOpen && <ol className="border-b p-3 text-sm" aria-label="Document versions">
      {versions.map((version) => <li key={version.id} className="flex items-center justify-between gap-2 py-1"><span>Version {version.versionNumber} · {version.authorUser?.name || version.authorAgent?.name} · {new Date(version.createdAt).toLocaleString()}</span><Button size="sm" variant="ghost" onClick={() => download(version.id)}>Download snapshot</Button></li>)}
      {!versions.length && <li>No saved versions yet.</li>}
      {nextVersionCursor && <li><Button size="sm" variant="ghost" onClick={loadOlderVersions} disabled={loadingVersions}>{loadingVersions ? 'Loading…' : 'Load older versions'}</Button></li>}
    </ol>}
    {!content && !error && <p role="status" className="p-6 text-sm">Loading document…</p>}
    {content && active && <div className="flex min-h-0 flex-1 flex-col" inert={converting} aria-busy={converting}>
      <UniverEditor initialContent={content} onReady={onReady} onDirty={onDirty} onError={setError}
        onSuspend={(snapshot, source) => setContent((current) => current === source ? snapshot : current)} />
    </div>}
  </div>;
}
