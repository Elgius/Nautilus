"use client";

import { useState } from "react";
import { Bot, Check, ChevronRight, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

const revisions = [
  {
    id: "v4",
    time: "10:42 AM",
    author: "Sarah Kim",
    initials: "SK",
    title: "Added customer context",
    summary: "Expanded the audience and clarified the problem we’re solving.",
    section: "What we’re working on",
    before: "Define the audience and the problem we’re solving.",
    after: "Focus on growing teams who need one place to coordinate people and agents. Validate their biggest collaboration challenges through customer interviews.",
  },
  {
    id: "v3",
    time: "10:36 AM",
    author: "Jamie Davis",
    initials: "JD",
    title: "Refined the next steps",
    summary: "Added a brief review and a first-draft milestone.",
    section: "Next steps",
    before: "Share your thoughts and agree on a direction.",
    after: "Review this brief and add any missing context. Share your thoughts in the room chat, then turn the agreed direction into an actionable first draft.",
  },
  {
    id: "v2",
    time: "10:30 AM",
    author: "Atlas",
    initials: "AT",
    agent: true,
    title: "Outlined the approach",
    summary: "Added a starting point for how the team will work together.",
    section: "Our approach",
    before: null,
    after: "Start with the context. Use the conversation to explore ideas, challenge assumptions, and make decisions together. Keep the shared document up to date as the work takes shape.",
  },
  {
    id: "v1",
    time: "10:25 AM",
    author: "Jamie Davis",
    initials: "JD",
    title: "Created the document",
    summary: "Started the room brief with a shared goal.",
    section: "The goal",
    before: null,
    after: "Align the team around a clear outcome, bring the right context together, and turn our ideas into a plan we can act on.",
  },
];

export function DocumentHistory({ documentName }: { documentName: string }) {
  const [selectedId, setSelectedId] = useState(revisions[0].id);
  const selected = revisions.find((revision) => revision.id === selectedId)!;

  return (
    <Sheet>
      <SheetTrigger render={<Button variant="ghost" size="sm" />}>
        <History size={15} />
        History
      </SheetTrigger>
      <SheetContent className="room-history-panel">
        <SheetHeader className="room-history-header">
          <div className="room-history-eyebrow"><History size={14} /> DOCUMENT ACTIVITY</div>
          <SheetTitle>History</SheetTitle>
          <SheetDescription>{documentName} · Working document</SheetDescription>
        </SheetHeader>
        <div className="room-history-scroll">
          <div className="room-history-day"><span>Today</span><span>4 versions</span></div>
          <ol className="room-history-timeline" aria-label="Document versions">
            {revisions.map((revision, index) => (
              <li key={revision.id}>
                <Button variant="ghost" size="sm"
                  className="room-history-version h-auto justify-start whitespace-normal"
                  aria-pressed={selectedId === revision.id}
                  onClick={() => setSelectedId(revision.id)}
                >
                  <span className={`room-history-avatar ${revision.agent ? "is-agent" : ""}`}>
                    {revision.agent ? <Bot size={16} /> : revision.initials}
                  </span>
                  <span className="room-history-version-body">
                    <span className="room-history-version-meta"><strong>{revision.author}</strong><span>{revision.time}</span></span>
                    <span className="room-history-version-title">{revision.title}</span>
                    <span className="room-history-summary">{revision.summary}</span>
                    {index === 0 && <span className="room-history-current"><Check size={11} /> Current version</span>}
                  </span>
                  <ChevronRight size={14} className="room-history-chevron" />
                </Button>
              </li>
            ))}
          </ol>
          <section className="room-history-preview" aria-label="Selected edit preview" aria-live="polite">
            <div className="room-history-preview-heading"><span>CHANGE PREVIEW</span><span>{selected.id}</span></div>
            <h3>{selected.section}</h3>
            {selected.before && <div className="room-history-change is-removed"><span>Removed</span><p>{selected.before}</p></div>}
            <div className="room-history-change is-added"><span>Added</span><p>{selected.after}</p></div>
          </section>
        </div>
        <p className="room-history-note">Sample edit history · UI preview</p>
      </SheetContent>
    </Sheet>
  );
}
