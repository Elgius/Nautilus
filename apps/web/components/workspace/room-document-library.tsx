"use client";

import { useEffect, useState } from "react";
import useSWRInfinite from "swr/infinite";
import { FileText, Table2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { workspaceFetch } from "@/lib/workspace-data";
import { ViewLoading } from "./view-boundary";

type LibraryPage = {
  documents: { id: string; title: string; kind: "DOCUMENT" | "SPREADSHEET"; status: string; updatedAt: string; room: { id: string; name: string } }[];
  nextCursor: string | null;
};

export function RoomDocumentLibrary({ organizationId, onOpen }: { organizationId: string; onOpen: (room: { id: string }) => void }) {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const { data, error, size, setSize, isValidating, mutate } = useSWRInfinite<LibraryPage>(
    (_index, previous: LibraryPage | null) => {
      if (previous && !previous.nextCursor) return null;
      const params = new URLSearchParams({ q: query });
      if (previous?.nextCursor) params.set("cursor", previous.nextCursor);
      return `/api/organizations/${encodeURIComponent(organizationId)}/documents?${params}`;
    },
    workspaceFetch<LibraryPage>,
  );
  const files = data?.flatMap((page) => page.documents) ?? [];
  const hasMore = !!data?.at(-1)?.nextCursor;
  return <section className="documents-library" aria-label="Room document library">
    <div className="page-heading"><div><h1>Your room documents</h1><p>Documents and spreadsheets from your organisation’s rooms.</p></div></div>
    <Input aria-label="Search documents" placeholder="Search documents…" maxLength={200} value={search} onChange={(event) => setSearch(event.target.value)} className="mb-5 max-w-md" />
    {error && <div role="alert" className="mb-4 rounded-lg border p-4"><p>{error.message}</p><Button variant="outline" className="mt-2" onClick={() => void mutate()}>Retry documents</Button></div>}
    {!data && !error && <ViewLoading />}
    <div className="documents-grid room-documents-grid">{files.map((document) => <article key={document.id} className="document-card p-5">
      {document.kind === "DOCUMENT" ? <FileText size={22} /> : <Table2 size={22} />}<h2 className="mt-3 font-medium">{document.title}</h2>
      <p className="my-2 text-sm text-muted-foreground">{document.room.name} · {document.status.toLowerCase().replaceAll("_", " ")}</p>
      <Button variant="outline" size="sm" className="w-1/2 min-w-24 self-start rounded-full" onClick={() => onOpen(document.room)}>Open room</Button>
    </article>)}</div>
    {data && !files.length && !error && <p className="py-8 text-sm text-muted-foreground">{query ? "No matching documents." : "Create a document or spreadsheet inside a room to add it to your library."}</p>}
    {hasMore && <Button variant="outline" className="mt-5" disabled={isValidating} onClick={() => void setSize(size + 1)}>{isValidating ? "Loading…" : "Load more documents"}</Button>}
  </section>;
}
