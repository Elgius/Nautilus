"use client";

import { useCallback, useEffect, useEffectEvent, useRef, useState, type FormEvent, type Dispatch } from 'react';
import dynamic from 'next/dynamic';
import { createPortal } from 'react-dom';
import { Download, Plus, Save, Upload, FileText, Sheet, FileImage, File, FolderOpen, X, History, ChevronDown, MousePointer2, LockKeyhole, Trash2 } from 'lucide-react';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from '@/components/ui/input';
import { Dropzone } from '@/components/ui/dropzone';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { errorMessage } from '@/lib/auth-client';
import { roomRequest, uploadRoomAttachment, type RoomAttachment, type RoomDocument, type DocumentVersion, type DocumentVersionsPage } from '@/lib/room-client';
import { downloadBlob, officeContent, type OfficeContent, type LegacyContent } from '@/lib/office-content';
import type { OfficeEditorHandle } from './univer-editor';
import { addLocalRoomFiles, MAX_LOCAL_FILES } from '@/lib/local-room-files';
import type { RoomFileState, RoomFileAction } from '@/lib/room-file-state';
import { LocalRoomFilePreview } from './local-room-file';
import { useRoomWork } from './use-room-work';
import { avatarColorValues } from '../../../../shared/agent-appearance';
import { parseDocumentPreview } from '../../../../shared/document-preview';
import { previewDocument } from '@/lib/document-preview';

const UniverEditor = dynamic(() => import('./univer-editor'), {
  ssr: false, loading: () => <p role="status" className="p-6 text-sm">Loading editor…</p>,
});

function RoomFileIcon({ kind }: { kind: string }) {
  const Icon = kind === 'SPREADSHEET' || /\.(xlsx?|csv|tsv)$/i.test(kind) ? Sheet : /\.(png|jpe?g|gif|webp)$/i.test(kind) ? FileImage : kind === 'DOCUMENT' || /\.(docx?|txt|md|pdf)$/i.test(kind) ? FileText : File;
  return <Icon size={15} className="room-file-icon" aria-hidden="true" />;
}

export function RoomDocuments({ dirtyDocumentIds, navigationContainer, actionsContainer, organizationId, roomId, initialDocuments, storageConfigured, officeConfigured = false, fileState, dispatchFiles, onSelect, onDirtyChange }: {
  dirtyDocumentIds: ReadonlySet<string>;
  navigationContainer: HTMLDivElement | null; actionsContainer: HTMLDivElement | null;
  organizationId: string; roomId: string; initialDocuments: RoomDocument[]; storageConfigured: boolean; officeConfigured?: boolean;
  fileState: RoomFileState; dispatchFiles: Dispatch<RoomFileAction>; onSelect: (id: string) => void;
  onDirtyChange: (id: string, dirty: boolean) => void;
}) {
  const [documents, setDocuments] = useState(initialDocuments);
  const [attachments, setAttachments] = useState<RoomAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState('');
  const [savingFiles, setSavingFiles] = useState<ReadonlySet<string>>(new Set());
  const [savedFiles, setSavedFiles] = useState<Record<string, string>>({});
  const savingFileIds = useRef(new Set<string>());
  const work = useRoomWork(organizationId, roomId);
  const { files: localFiles, selectedId, uploadOpen, error: uploadError } = fileState;
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [fileSearch, setFileSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [visitedIds, setVisitedIds] = useState<string[]>([]);
  const markLoaded = useCallback((id: string) => setVisitedIds((previous) => previous.includes(id) ? previous : [...previous, id]), []);
  const selected = documents.find((document) => document.id === selectedId);
  const selectedLocalFile = localFiles.find((entry) => entry.id === selectedId);
  const selectedAttachment = attachments.find((attachment) => attachment.id === selectedId);
  const refreshAttachments = useCallback(async () => {
    const result = await roomRequest<{ attachments: RoomAttachment[] }>(organizationId, `/${encodeURIComponent(roomId)}/attachments`);
    setAttachments(result.attachments);
  }, [organizationId, roomId]);
  useEffect(() => {
    let cancelled = false;
    roomRequest<{ attachments: RoomAttachment[] }>(organizationId, `/${encodeURIComponent(roomId)}/attachments`)
      .then((result) => { if (!cancelled) setAttachments(result.attachments); })
      .catch((error) => { if (!cancelled) setAttachmentError(errorMessage(error)); });
    return () => { cancelled = true; };
  }, [organizationId, roomId]);
  async function saveLocalFile(id: string) {
    const entry = localFiles.find((file) => file.id === id);
    if (!entry || work.readOnly || !storageConfigured || savingFileIds.current.has(id) || savedFiles[id]) return;
    savingFileIds.current.add(id); setSavingFiles(new Set(savingFileIds.current)); setAttachmentError('');
    try {
      const attachment = await uploadRoomAttachment(organizationId, roomId, entry.file);
      setAttachments((previous) => [...previous.filter((item) => item.id !== attachment.id), attachment]);
      setSavedFiles((previous) => ({ ...previous, [id]: attachment.id }));
    } catch (error) { setAttachmentError(errorMessage(error)); }
    finally { savingFileIds.current.delete(id); setSavingFiles(new Set(savingFileIds.current)); }
  }
  async function uploadLocalFiles(files: File[]) {
    try {
      dispatchFiles({ type: 'add', entries: addLocalRoomFiles([], files) });
    } catch (error) { dispatchFiles({ type: 'upload-error', message: errorMessage(error) }); }
  }
  function removeLocalFile(id: string) {
    dispatchFiles({ type: 'remove', id, fallbackId: documents[0]?.id });
  }
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (creating || work.readOnly) return;
    const data = new FormData(event.currentTarget);
    setCreating(true); setError('');
    try {
      const result = await roomRequest<{ document: RoomDocument }>(organizationId, `/${roomId}/documents`, 'POST', {
        title: String(data.get('title')), kind: String(data.get('kind')),
      });
      setDocuments((previous) => [...previous, result.document]);
      onSelect(result.document.id); setCreateOpen(false);
    } catch (error) { setError(errorMessage(error)); }
    finally { setCreating(false); }
  }
  const files = [...documents.map((document) => ({ id: document.id, title: document.title, kind: document.kind, local: false })), ...attachments.map((attachment) => ({ id: attachment.id, title: attachment.filename, kind: attachment.filename, local: false })), ...localFiles.map((entry) => ({ id: entry.id, title: entry.file.name, kind: entry.file.name, local: true }))];
  function closeTab(id: string) {
    dispatchFiles({ type: 'close', id });
    // Restore focus after the close control itself is removed.
    requestAnimationFrame(() => (navigationContainer?.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]') ?? navigationContainer?.querySelector<HTMLButtonElement>('[aria-label="Browse room files"]'))?.focus());
  }
  return <>
    {navigationContainer && createPortal(<>
      <div className="room-open-file-tabs" role="tablist" aria-label="Room files" onKeyDown={(event) => {
        const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
        const index = tabs.indexOf(event.target as HTMLButtonElement);
        if (index < 0) return;
        const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index - 1 + tabs.length) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
        if (next < 0) return;
        event.preventDefault(); tabs[next].focus(); tabs[next].click();
      }}>
        {fileState.openIds.map((id) => files.find((file) => file.id === id)).filter((file) => file !== undefined).map((file) =>
          <div key={file.id} className="room-file-tab" data-active={selectedId === file.id}>
            <Button id={`file-tab-${file.id}`} role="tab" aria-selected={selectedId === file.id} aria-controls={`file-panel-${file.id}`} tabIndex={selectedId === file.id ? 0 : -1}
              variant="ghost" size="sm" title={file.title} onClick={() => onSelect(file.id)}>
              <RoomFileIcon kind={file.kind} /><span className="truncate">{file.title}</span>
              {dirtyDocumentIds.has(file.id) && <span className="room-unsaved-dot" aria-label="Unsaved changes" />}
              {file.local && <span className="room-tab-local">Local</span>}
            </Button>
            <Button className="room-tab-close" variant="ghost" size="icon-sm" aria-label={`Close ${file.title} tab`} onClick={() => closeTab(file.id)}><X size={12} /></Button>
          </div>)}
      </div>
      <Button type="button" variant="ghost" size="sm" aria-label="Browse room files" onClick={() => { setFileSearch(''); setLibraryOpen(true); void refreshAttachments().catch((error) => setAttachmentError(errorMessage(error))); }}><FolderOpen size={15} /><span className="room-nav-button-label">Files</span></Button>
      <Button type="button" variant="ghost" size="sm" disabled={work.readOnly} onClick={() => { setError(''); setCreateOpen(true); }}><Plus size={14} />New</Button>
      <Button type="button" variant="ghost" size="sm" onClick={() => { dispatchFiles({ type: 'upload-dialog', open: true }); }} disabled={localFiles.length >= MAX_LOCAL_FILES}><Upload size={14} />Upload files</Button>
    </>, navigationContainer)}
    <Dialog open={libraryOpen} onOpenChange={setLibraryOpen}>
      <DialogContent className="sm:max-w-xl"><DialogHeader><DialogTitle>Room files</DialogTitle><DialogDescription>Open a file in a tab. Closing a tab keeps its file here.</DialogDescription></DialogHeader>
        <Input aria-label="Search room files" placeholder="Search files…" value={fileSearch} onChange={(event) => setFileSearch(event.target.value)} />
        <div className="room-file-library">
          {files.filter((file) => file.title.toLowerCase().includes(fileSearch.toLowerCase())).map((file) => <Button key={file.id} variant="ghost" className="room-library-file" onClick={() => { onSelect(file.id); setLibraryOpen(false); }}>
            <RoomFileIcon kind={file.kind} /><span className="truncate">{file.title}</span><span className="room-library-status">{file.local ? 'Local file' : dirtyDocumentIds.has(file.id) ? 'Unsaved changes' : attachments.some((attachment) => attachment.id === file.id) ? 'Saved file' : 'Room document'}</span>
          </Button>)}
          {!files.some((file) => file.title.toLowerCase().includes(fileSearch.toLowerCase())) && <p className="p-6 text-sm text-muted-foreground">{files.length ? 'No matching files.' : 'Create a document or upload files to get started.'}</p>}
        </div>
      </DialogContent>
    </Dialog>
    <Dialog open={uploadOpen} onOpenChange={(open) => dispatchFiles({ type: 'upload-dialog', open })}>
      <DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>Upload files from your computer</DialogTitle>
        <DialogDescription>Choose one or more files to open in this tab. Selecting files does not upload or share them. Use Save to room on a file to keep a shared copy. Leaving or refreshing the room clears local files.</DialogDescription></DialogHeader>
        <Dropzone description="Documents, PDFs, spreadsheets, images, and other files" maxFiles={MAX_LOCAL_FILES} onFiles={uploadLocalFiles} />
        {uploadError && <p role="alert" className="text-sm text-destructive">{uploadError}</p>}
      </DialogContent>
    </Dialog>
    <Dialog open={createOpen} onOpenChange={(open) => { if (!creating) setCreateOpen(open); }}>
      <DialogContent><DialogHeader><DialogTitle>Create a room file</DialogTitle>
        <DialogDescription>Start a new document or spreadsheet in this room.</DialogDescription></DialogHeader>
        <form onSubmit={create} className="flex flex-wrap gap-2" aria-busy={creating}>
          <Input name="title" aria-label="New document title" placeholder="Document title" maxLength={150} required className="min-w-32 flex-1" disabled={creating} />
          <Select name="kind" defaultValue="DOCUMENT" disabled={creating}
            items={[{ value: 'DOCUMENT', label: 'Document' }, { value: 'SPREADSHEET', label: 'Spreadsheet' }]}>
            <SelectTrigger aria-label="Document type"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="DOCUMENT">Document</SelectItem><SelectItem value="SPREADSHEET">Spreadsheet</SelectItem></SelectContent>
          </Select>
          <Button type="submit" size="sm" variant="outline" disabled={creating || work.readOnly}><Plus size={14} />{creating ? 'Creating…' : 'Create'}</Button>
        </form>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
    {(work.readOnly || work.queued > 0) && <div className="room-agent-work" role="status">
      <p><LockKeyhole size={14} />{!work.available ? 'Checking room activity. Documents are read-only.' : work.locked ? 'Agents are working. Room documents are read-only until they finish.' : 'Requests are queued.'}{work.queued > 0 ? ` ${work.queued} queued.` : ''}</p>
      {work.activities.map((activity) => <button type="button" key={activity.agentId} className="room-agent-work-target" disabled={!activity.documentId}
        onClick={() => { if (activity.documentId) onSelect(activity.documentId); }}>
        <MousePointer2 size={15} fill="currentColor" style={{ color: avatarColorValues[activity.color ?? 'violet'] }} />
        <strong>{activity.agentName}</strong><span>{activity.phase} · {documents.find((document) => document.id === activity.documentId)?.title ?? 'Planning'}{activity.target ? ` · ${activity.target}` : ''}</span>
      </button>)}
    </div>}
    {documents.filter((document) => document.id === selectedId || visitedIds.includes(document.id)).map((document) =>
      <div key={document.id} id={`file-panel-${document.id}`} role="tabpanel" aria-labelledby={`file-tab-${document.id}`} className="min-h-0 flex-1 flex-col" style={{ display: document.id === selectedId ? 'flex' : 'none' }}>
        <RoomDocumentEditor readOnly={work.readOnly} remoteVersionId={work.versions?.[document.id]} actionsContainer={actionsContainer} active={document.id === selectedId} organizationId={organizationId} roomId={roomId} document={document} storageConfigured={storageConfigured} officeConfigured={officeConfigured} onLoaded={markLoaded} onDirtyChange={onDirtyChange} />
      </div>)}
    {attachmentError && <p role="alert" className="p-3 text-sm text-destructive">{attachmentError}</p>}
    {selectedAttachment && <div id={`file-panel-${selectedAttachment.id}`} role="tabpanel" aria-labelledby={`file-tab-${selectedAttachment.id}`} className="min-h-0 flex-1">
      <SavedRoomAttachment attachment={selectedAttachment} organizationId={organizationId} roomId={roomId} actionsContainer={actionsContainer} readOnly={work.readOnly}
        onRemoved={() => {
          setAttachments((previous) => previous.filter((item) => item.id !== selectedAttachment.id));
          setSavedFiles((previous) => Object.fromEntries(Object.entries(previous).filter(([, id]) => id !== selectedAttachment.id)));
          dispatchFiles({ type: 'close', id: selectedAttachment.id });
        }} />
    </div>}
    {localFiles.filter((entry) => fileState.visitedIds.includes(entry.id)).map((entry) =>
      <div key={entry.id} id={`file-panel-${entry.id}`} role="tabpanel" aria-labelledby={`file-tab-${entry.id}`} className="min-h-0 flex-1 flex-col" style={{ display: entry.id === selectedId ? 'flex' : 'none' }}>
        <LocalRoomFilePreview actionsContainer={actionsContainer} active={entry.id === selectedId} entry={entry} onSave={storageConfigured && !work.readOnly ? () => void saveLocalFile(entry.id) : undefined} saving={savingFiles.has(entry.id)} saved={!!savedFiles[entry.id]} onRemove={() => removeLocalFile(entry.id)} />
      </div>)}
    {!selected && !selectedLocalFile && !selectedAttachment && <p className="p-6 text-sm text-muted-foreground">Choose a file from Files, create a document, or upload one to begin.</p>}
  </>;
}

function SavedRoomAttachment({ attachment, organizationId, roomId, actionsContainer, readOnly, onRemoved }: {
  attachment: RoomAttachment; organizationId: string; roomId: string; actionsContainer: HTMLDivElement | null;
  readOnly: boolean; onRemoved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const path = `/${encodeURIComponent(roomId)}/attachments/${encodeURIComponent(attachment.id)}`;
  async function download() {
    setBusy(true); setError('');
    try {
      const { url } = await roomRequest<{ url: string }>(organizationId, `${path}/url`);
      const link = document.createElement('a'); link.href = url; link.rel = 'noopener noreferrer'; link.click();
    } catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!window.confirm(`Delete “${attachment.filename}” from this room? This removes the stored original for everyone.`)) return;
    setBusy(true); setError('');
    try { await roomRequest(organizationId, path, 'DELETE'); onRemoved(); }
    catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  }
  return <section className="p-5" aria-label={`Saved file ${attachment.filename}`}>
    {actionsContainer && createPortal(<div className="room-document-toolbar">
      <div className="room-active-file"><RoomFileIcon kind={attachment.filename} /><strong>{attachment.filename}</strong></div>
      <span role="status" className="room-save-status">Saved to room</span>
      <Button size="sm" onClick={download} disabled={busy}><Download size={14} />Download original</Button>
      <Button size="sm" variant="ghost" onClick={remove} disabled={busy || readOnly}><Trash2 size={14} />Delete from room</Button>
    </div>, actionsContainer)}
    <p className="break-all font-medium">{attachment.filename}</p>
    <p className="mt-2 text-sm text-muted-foreground">{attachment.sizeBytes.toLocaleString()} bytes · {attachment.mimeType}</p>
    <p className="mt-2 text-sm text-muted-foreground">This original file is saved and shared with the room. Download it to open it. Importing a copy into a document is a separate action.</p>
    {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
  </section>;
}

function RoomDocumentEditor({ actionsContainer, active, organizationId, roomId, document, storageConfigured, officeConfigured, onLoaded, onDirtyChange, readOnly, remoteVersionId }: {
  readOnly: boolean; remoteVersionId?: string | null;
  actionsContainer: HTMLDivElement | null;
  active: boolean;
  organizationId: string; roomId: string; document: RoomDocument; storageConfigured: boolean; officeConfigured: boolean;
  onLoaded: (id: string) => void;
  onDirtyChange: (id: string, dirty: boolean) => void;
}) {
  const path = `/${encodeURIComponent(roomId)}/documents/${encodeURIComponent(document.id)}`;
  const endpoint = `/api/organizations/${encodeURIComponent(organizationId)}/rooms${path}`;
  const [content, setContent] = useState<OfficeContent | null>(null);
  const [versionId, setVersionId] = useState<string | null>(document.currentVersionId);
  const [supersededVersions, setSupersededVersions] = useState<(string | null)[]>([document.currentVersionId]);
  const [versions, setVersions] = useState<DocumentVersion[]>([]);
  const [nextVersionCursor, setNextVersionCursor] = useState<string | null>(null);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false), [dirty, setDirty] = useState(false);
  const [converting, setConverting] = useState(false), [editorReady, setEditorReady] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false), [notice, setNotice] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const editor = useRef<OfficeEditorHandle | null>(null);
  const savedContent = useRef<OfficeContent | null>(null);
  const preview = useRef<{ runId: string; toolCallId: string; base: OfficeContent } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const revision = useRef(0);
  const newerVersion = remoteVersionId !== undefined && remoteVersionId !== versionId && !supersededVersions.includes(remoteVersionId);
  const editingBlocked = readOnly || newerVersion || previewing;
  const adoptContent = useCallback((next: OfficeContent) => {
    savedContent.current = next;
    if (!editor.current?.updateContent?.(next)) setContent(next);
  }, []);
  const onReady = useCallback((handle: OfficeEditorHandle | null) => { editor.current = handle; setEditorReady(!!handle); }, []);
  const onDirty = useCallback(() => { revision.current++; setDirty(true); setNotice(''); }, []);
  useEffect(() => {
    let active = true;
    Promise.all([
      roomRequest<{ content: OfficeContent | LegacyContent | null; currentVersionId: string | null }>(organizationId, `${path}/content`),
      roomRequest<DocumentVersionsPage>(organizationId, `${path}/versions`),
    ]).then(([saved, history]) => {
      if (!active) return;
      adoptContent(officeContent(document.kind, document.id, document.title, saved.content));
      setVersionId(saved.currentVersionId); setVersions(history.versions); setNextVersionCursor(history.nextCursor); onLoaded(document.id);
    }).catch((error) => { if (active) setError(errorMessage(error)); });
    return () => { active = false; };
  }, [organizationId, path, document.id, document.kind, document.title, onLoaded, adoptContent]);
  const receivePreview = useEffectEvent((event: Event) => {
    const detail = (event as CustomEvent<{ organizationId: string; roomId: string; runId?: string; toolCallId?: string; input: string | null }>).detail;
    if (detail.organizationId !== organizationId || detail.roomId !== roomId) return;
    if (detail.input === null) {
      const current = preview.current;
      if (!current || (detail.runId && detail.runId !== current.runId) || (detail.toolCallId && detail.toolCallId !== current.toolCallId)) return;
      // Reconcile to authoritative content after review, rejection, cancellation
      // or disconnect. Keep the preview visible until the saved result arrives.
      void Promise.all([
        roomRequest<{ content: OfficeContent | LegacyContent | null; currentVersionId: string | null }>(organizationId, `${path}/content`, 'GET', undefined, AbortSignal.timeout(5000)),
        roomRequest<DocumentVersionsPage>(organizationId, `${path}/versions`, 'GET', undefined, AbortSignal.timeout(5000)),
      ]).then(([saved, history]) => {
          if (preview.current !== current) return;
          adoptContent(officeContent(document.kind, document.id, document.title, saved.content));
          setSupersededVersions((previous) => [...previous, versionId].slice(-50));
          setVersionId(saved.currentVersionId);
          setVersions(history.versions); setNextVersionCursor(history.nextCursor);
        }).catch(() => {
          if (preview.current === current) editor.current?.updateContent?.(current.base);
        }).finally(() => {
          if (preview.current === current) { preview.current = null; setPreviewing(false); }
        });
      return;
    }
    if (dirty || saving || !detail.runId || !detail.toolCallId || !editor.current?.updateContent) return;
    const draft = parseDocumentPreview(detail.input);
    if (!draft || draft.documentId !== document.id || draft.expectedVersionId !== versionId) return;
    const base = savedContent.current;
    if (!base) return;
    try {
      const next = previewDocument(base, draft);
      if (next && editor.current.updateContent(next, true)) {
        preview.current = { runId: detail.runId, toolCallId: detail.toolCallId, base };
        setPreviewing(true);
      }
    } catch { /* Complex document structures wait for authoritative saved content. */ }
  });
  useEffect(() => {
    const receive = (event: Event) => receivePreview(event);
    window.addEventListener('room-document-preview', receive);
    return () => { window.removeEventListener('room-document-preview', receive); preview.current = null; };
  }, [organizationId, roomId, document.id]);
  useEffect(() => {
    if (!readOnly && preview.current) receivePreview(new CustomEvent('room-document-preview', { detail: { organizationId, roomId, input: null } }));
  }, [readOnly, organizationId, roomId]);
  // Apply saved versions during a run in the existing editor. Local drafts are
  // never replaced, and a streamed preview waits for its tool's final result.
  useEffect(() => {
    if (!newerVersion || dirty || saving || !content || preview.current) return;
    let cancelled = false;
    const started = revision.current;
    Promise.all([
      roomRequest<{ content: OfficeContent | LegacyContent | null; currentVersionId: string | null }>(organizationId, `${path}/content`),
      roomRequest<DocumentVersionsPage>(organizationId, `${path}/versions`),
    ]).then(([saved, history]) => {
      if (cancelled || started !== revision.current || preview.current) return;
      adoptContent(officeContent(document.kind, document.id, document.title, saved.content));
      setSupersededVersions((previous) => [...previous, versionId].slice(-50));
      setVersionId(saved.currentVersionId); setVersions(history.versions); setNextVersionCursor(history.nextCursor);
    }).catch((error) => { if (!cancelled) setError(errorMessage(error)); });
    return () => { cancelled = true; };
  }, [newerVersion, remoteVersionId, dirty, saving, content, organizationId, path, document.kind, document.id, document.title, versionId, previewing, adoptContent]);
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
    if (saving || editingBlocked || !editor.current) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const snapshot = await editor.current.snapshot(), savedRevision = revision.current;
      const { version } = await roomRequest<{ version: DocumentVersion }>(organizationId, `${path}/versions`, 'POST', {
        expectedVersionId: versionId, content: snapshot,
      });
      setSupersededVersions((previous) => [...previous, versionId].slice(-50));
      setVersionId(version.id); setVersions((previous) => [version, ...previous]);
      savedContent.current = snapshot;
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
    if (converting || saving || editingBlocked) return;
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
  async function downloadSnapshot() {
    if (!editor.current) return;
    try { downloadBlob(new Blob([JSON.stringify(await editor.current.snapshot())], { type: 'application/json' }), `${document.title}.json`); }
    catch (error) { setError(errorMessage(error)); }
  }
  async function download(id: string) {
    setError('');
    try {
      const { url } = await roomRequest<{ url: string }>(organizationId, `${path}/versions/${encodeURIComponent(id)}/url`);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (error) { setError(errorMessage(error)); }
  }
  const isDoc = document.kind === 'DOCUMENT';
  return <div className="room-document-editor">
    {active && actionsContainer && createPortal(<div className="room-document-toolbar">
      <div className="room-active-file"><RoomFileIcon kind={document.kind} /><strong title={document.title}>{document.title}</strong></div>
      <span className="room-save-status" role="status" title={!storageConfigured ? 'Room saving is unavailable. Export a copy to keep your work.' : undefined}>{previewing ? 'Agent writing · draft preview' : readOnly ? 'Read-only' : saving ? 'Saving…' : dirty ? 'Unsaved changes' : versionId ? 'Saved' : 'Not saved'}</span>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="sm" />} aria-label="File menu">File<ChevronDown size={12} /></DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-52">
          <DropdownMenuItem onClick={() => setHistoryOpen(true)}><History size={14} />Version history ({versions.length}{nextVersionCursor ? '+' : ''})</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setImportOpen(true)} disabled={editingBlocked || !officeConfigured || !editorReady || converting || saving}><Upload size={14} />Import {isDoc ? 'Word document' : 'spreadsheet'}</DropdownMenuItem>
          <DropdownMenuItem onClick={exportFile} disabled={!officeConfigured || !editorReady || converting || saving}><Download size={14} />Export {isDoc ? '.docx' : '.xlsx'}</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={downloadSnapshot} disabled={!content || !editorReady || converting}>
            <Download size={14} />Download document snapshot
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {storageConfigured && <Button size="sm" onClick={save} disabled={editingBlocked || saving || converting || !editorReady || (!dirty && !!versionId)}><Save size={14} />{saving ? 'Saving…' : 'Save'}</Button>}
    </div>, actionsContainer)}
    <Dialog open={importOpen} onOpenChange={(open) => { if (!converting) setImportOpen(open); }}>
      <DialogContent showCloseButton={!converting} className="sm:max-w-lg">
        <DialogHeader><DialogTitle>Import {isDoc ? 'a Word document' : 'a spreadsheet'}</DialogTitle>
          <DialogDescription>Open a file in this editor. Import replaces its current contents; saved versions remain in History.</DialogDescription></DialogHeader>
        <Dropzone busy={converting} disabled={saving || editingBlocked} description={isDoc ? 'Word files (.doc, .docx)' : 'Excel or text files (.xls, .xlsx, .csv, .tsv)'}
          accept={isDoc ? { 'application/msword': ['.doc'], 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'] } : {
            'application/vnd.ms-excel': ['.xls'], 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'], 'text/csv': ['.csv'], 'text/tab-separated-values': ['.tsv'],
          }} onFile={importFile} />
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
    {error && <p role="alert" className="p-3 text-sm text-destructive">{error}</p>}
    {notice && <p role="status" className="p-2 text-sm text-muted-foreground">{notice}</p>}
    {newerVersion && dirty && <div role="status" className="p-3 text-sm">
      <p>The saved document changed. Your unsaved draft is preserved. Download it before opening the latest version.</p>
      <Button size="sm" variant="outline" onClick={downloadSnapshot}>Download my draft</Button>
      <Button size="sm" variant="ghost" disabled={readOnly} onClick={async () => {
        if (!window.confirm('Discard this unsaved draft and open the latest saved version? Download your draft first to keep a copy.')) return;
        try {
          const saved = await roomRequest<{ content: OfficeContent | LegacyContent | null; currentVersionId: string | null }>(organizationId, `${path}/content`);
          adoptContent(officeContent(document.kind, document.id, document.title, saved.content)); setVersionId(saved.currentVersionId); setDirty(false);
        } catch (error) { setError(errorMessage(error)); }
      }}>Open latest version</Button>
    </div>}
    {converting && <p role="status" className="p-2 text-sm">Converting file…</p>}
    <Dialog open={historyOpen} onOpenChange={setHistoryOpen}><DialogContent className="sm:max-w-xl"><DialogHeader><DialogTitle>Version history</DialogTitle><DialogDescription>Saved versions of {document.title}.</DialogDescription></DialogHeader><ol className="max-h-80 overflow-auto text-sm" aria-label="Document versions">
      {versions.map((version) => <li key={version.id} className="flex items-center justify-between gap-2 py-1"><span>Version {version.versionNumber} · {version.authorUser?.name || version.authorAgent?.name} · {new Date(version.createdAt).toLocaleString()}</span><Button size="sm" variant="ghost" onClick={() => download(version.id)}>Download snapshot</Button></li>)}
      {!versions.length && <li>No saved versions yet.</li>}
      {nextVersionCursor && <li><Button size="sm" variant="ghost" onClick={loadOlderVersions} disabled={loadingVersions}>{loadingVersions ? 'Loading…' : 'Load older versions'}</Button></li>}
    </ol></DialogContent></Dialog>
    {!content && !error && <p role="status" className="p-6 text-sm">Loading document…</p>}
    {content && active && <div className="flex min-h-0 flex-1 flex-col" inert={converting} aria-busy={converting}>
      <UniverEditor initialContent={content} readOnly={editingBlocked} onReady={onReady} onDirty={onDirty} onError={setError}
        onSuspend={(snapshot, source) => setContent((current) => current === source ? snapshot : current)} />
    </div>}
  </div>;
}
