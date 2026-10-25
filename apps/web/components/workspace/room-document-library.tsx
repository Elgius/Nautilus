"use client";

import { useState } from 'react';
import { FileText, Table2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import type { Room } from '@/lib/room-data';

export function RoomDocumentLibrary({ rooms, onOpen }: { rooms: Room[]; onOpen: (room: Room) => void }) {
  const [search, setSearch] = useState('');
  const files = rooms.flatMap((room) => room.documents.map((document) => ({ room, document })));
  const visible = files.filter(({ room, document }) => `${room.name} ${document.title}`.toLowerCase().includes(search.toLowerCase()));
  return <section className="documents-library" aria-label="Room document library">
    <div className="page-heading"><div><h1>Your room documents</h1><p>Documents and spreadsheets from your organisation’s rooms.</p></div></div>
    <Input aria-label="Search documents" placeholder="Search documents…" value={search} onChange={(event) => setSearch(event.target.value)} className="mb-5 max-w-md" />
    <div className="documents-grid">{visible.map(({ room, document }) => <article key={document.id} className="document-card p-5">
      {document.kind === 'DOCUMENT' ? <FileText size={22} /> : <Table2 size={22} />}<h2 className="mt-3 font-medium">{document.title}</h2>
      <p className="my-2 text-sm text-muted-foreground">{room.name} · {document.status.toLowerCase().replaceAll('_', ' ')}</p>
      <Button variant="outline" size="sm" onClick={() => onOpen(room)}>Open room</Button>
    </article>)}</div>
    {!visible.length && <p className="py-8 text-sm text-muted-foreground">{files.length ? 'No matching documents.' : 'Create a document or spreadsheet inside a room to add it to your library.'}</p>}
  </section>;
}
