"use client";

import { useState, type FormEvent } from "react";
import {
  ArrowUpRight,
  FileText,
  FolderOpen,
  Pencil,
  Plus,
  Search,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  documentTemplates,
  type DocumentTemplate,
  type DocumentCategory,
} from "@/lib/document-templates";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Document = {
  id: string;
  title: string;
  category: DocumentCategory;
  room: string;
  author: string;
  updated: string;
  status: "Draft" | "In review" | "Ready";
  body: string;
};
const sampleDocuments: Document[] = [
  {
    id: "launch-brief",
    title: "Q4 launch brief",
    category: "Briefs",
    room: "Q4 product launch",
    author: "Nova",
    updated: "2 minutes ago",
    status: "In review",
    body: "A clear story. A shared direction.\n\nThe opportunity\nBring our next product release to the people who need it most, with one consistent story across every touchpoint.\n\nWho we’re reaching\nSmall teams looking for a better way to bring their people, agents, and context together.\n\nThe plan\n1. Align on the core message and audience.\n2. Build the launch narrative and supporting assets.\n3. Share a first draft with the team for feedback.\n\nWhat success looks like\nA confident launch, a clear value proposition, and a team moving in the same direction.",
  },
  {
    id: "customer-insights",
    title: "What our customers are telling us",
    category: "Research",
    room: "Customer discovery",
    author: "Atlas",
    updated: "18 minutes ago",
    status: "Ready",
    body: "Customer discovery · Research synthesis\n\nThe big picture\nTeams want less time spent finding context and more time spent doing meaningful work.\n\nThree themes\n• Information is scattered across too many tools.\n• Clear ownership helps projects move faster.\n• AI is most useful when it understands the team’s context.\n\nQuestions to explore\nHow do teams build trust in an agent’s work? What information should stay close to the conversation?\n\nNext step\nValidate these themes in the next round of interviews.",
  },
  {
    id: "platform-plan",
    title: "Platform architecture proposal",
    category: "Briefs",
    room: "Platform engineering",
    author: "Cipher",
    updated: "35 minutes ago",
    status: "Draft",
    body: "Building a dependable foundation\n\nObjective\nMake the platform simpler to maintain, easier to extend, and more reliable for every team.\n\nDesign principles\n• Keep responsibilities clear.\n• Prefer simple interfaces between components.\n• Measure reliability before optimizing.\n\nProposed milestones\n1. Map current dependencies.\n2. Document the key architectural decisions.\n3. Agree on an incremental implementation plan.\n\nOpen question\nWhich bottleneck has the greatest impact on the team today?",
  },
  {
    id: "messaging",
    title: "Our story, in a few words",
    category: "Guides",
    room: "Q4 product launch",
    author: "Nova",
    updated: "1 hour ago",
    status: "Ready",
    body: "Messaging & voice guide\n\nThe promise\nYour people and agents, moving work forward together.\n\nHow we sound\nClear, thoughtful, and human. We use familiar words and lead with what matters to the reader.\n\nWhat we believe\nGood work happens when the right people have the right context. Our role is to bring those pieces together.\n\nWriting checklist\n• Start with the benefit.\n• Keep sentences direct.\n• Show a concrete example.\n• Make the next step clear.",
  },
  {
    id: "onboarding",
    title: "A little guide to getting started",
    category: "Guides",
    room: "Workspace",
    author: "Jamie Davis",
    updated: "Yesterday",
    status: "Ready",
    body: "Welcome to your shared workspace\n\nMake yourself at home\nCreate a room for your next goal, invite the people involved, and give your agents the context they need.\n\nYour first room\nStart with a clear title and a short brief. Keep the conversation focused on the outcome you want to achieve.\n\nMeet your agents\nEach agent has a purpose. Customize their names, avatars, and rules to make the team feel like yours.\n\nKeep the thinking\nUse documents to capture ideas, decisions, and the work that comes out of your conversations.",
  },
  {
    id: "interview-notes",
    title: "Discovery interview notes",
    category: "Research",
    room: "Customer discovery",
    author: "Sage",
    updated: "Yesterday",
    status: "Draft",
    body: "Discovery conversations · Round one\n\nWhat we set out to learn\nHow teams share context, make decisions, and bring new collaborators up to speed.\n\nDiscussion prompts\n• Walk us through your last team project.\n• Where do important decisions live?\n• What takes the most effort to explain to someone new?\n\nEarly observations\nThe most valuable context is often the hardest to find. Teams need a shared place for both the discussion and the outcome.\n\nFollow-up\nGroup observations by theme and identify questions for the next round.",
  },
];

export function DocumentsLibrary() {
  const [documents, setDocuments] = useState(sampleDocuments);
  const [activeTab, setActiveTab] = useState("documents");
  const [templateSearch, setTemplateSearch] = useState("");
  const categories = [
    "All documents",
    ...new Set(documents.map((document) => document.category)),
  ];
  const visibleTemplates = documentTemplates.filter((template) =>
    `${template.title} ${template.category} ${template.description}`
      .toLowerCase()
      .includes(templateSearch.toLowerCase()),
  );
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("All documents");
  const [selected, setSelected] = useState<Document | null>(null);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [isNew, setIsNew] = useState(false);
  const visible = documents.filter(
    (document) =>
      (category === "All documents" || document.category === category) &&
      `${document.title} ${document.room} ${document.author}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );

  function openDocument(document: Document, create = false) {
    setSelected(document);
    setTitle(document.title);
    setBody(document.body);
    setIsNew(create);
    setEditing(create);
  }
  function createDocument() {
    openDocument(
      {
        id: crypto.randomUUID(),
        title: "Untitled document",
        category: "Briefs",
        room: "Workspace",
        author: "Jamie Davis",
        updated: "Just now",
        status: "Draft",
        body: "",
      },
      true,
    );
  }
  function createFromTemplate(template: DocumentTemplate) {
    openDocument(
      {
        id: crypto.randomUUID(),
        title:
          template.title === "Blank document"
            ? "Untitled document"
            : template.title,
        category: template.category,
        room: "Workspace",
        author: "Jamie Davis",
        updated: "Just now",
        status: "Draft",
        body: template.sections
          .map((section) => `${section}\n[Add your details here]`)
          .join("\n\n"),
      },
      true,
    );
  }
  function saveDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !title.trim()) return;
    const updated = {
      ...selected,
      title: title.trim(),
      body,
      updated: "Just now",
    };
    setDocuments((previous) =>
      isNew
        ? [updated, ...previous]
        : previous.map((document) =>
            document.id === updated.id ? updated : document,
          ),
    );
    setSelected(updated);
    setIsNew(false);
    setEditing(false);
    setCategory("All documents");
    setSearch("");
    setActiveTab("documents");
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            <span />
            YOUR TEAM, IN SYNC
          </div>
          <h1>A home for your team’s thinking.</h1>
          <p>Briefs, research, and shared ideas. All in one place.</p>
        </div>
        <Button className="primary-action" onClick={createDocument}>
          <Plus size={16} />
          New document
        </Button>
      </div>
      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(String(value))}
        className="documents-library"
      >
        <TabsList aria-label="Document sections" className="mb-5">
          <TabsTrigger value="documents">Your documents</TabsTrigger>
          <TabsTrigger value="templates">Templates</TabsTrigger>
        </TabsList>
        <TabsContent value="documents">
          <section aria-label="Document library">
            <div className="documents-summary">
              <div className="documents-summary-icon">
                <FolderOpen size={22} />
              </div>
              <div>
                <h2>
                  Your shared library <span>{documents.length} documents</span>
                </h2>
                <p>
                  The context behind the conversations. The ideas that move work
                  forward.
                </p>
              </div>
              <span className="documents-sample-label">Sample library</span>
            </div>
            <div className="documents-toolbar">
              <div
                className="documents-filters"
                role="group"
                aria-label="Filter documents"
              >
                {categories.map((item) => (
                  <Button variant="ghost" size="sm"
                    key={item}
                    aria-pressed={category === item}
                    onClick={() => setCategory(item)}
                  >
                    {item}
                  </Button>
                ))}
              </div>
              <div className="documents-search">
                <Search size={15} />
                <Input
                  aria-label="Search documents"
                  placeholder="Search documents…"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
                {search && (
                  <Button variant="ghost" size="sm"
                    aria-label="Clear document search"
                    onClick={() => setSearch("")}
                  >
                    <X size={13} />
                  </Button>
                )}
              </div>
            </div>
            <div className="documents-results">
              <span>
                {category === "All documents" ? "All documents" : category}
                <span>{visible.length}</span>
              </span>
              <span>Recently updated</span>
            </div>
            <div className="documents-grid">
              {visible.map((document) => (
                <Button variant="ghost" size="sm"
                  key={document.id}
                  className="document-card h-auto items-stretch justify-start whitespace-normal p-0"
                  onClick={() => openDocument(document)}
                  aria-label={`Open ${document.title}`}
                >
                  <div
                    className={`document-thumbnail document-thumbnail-${document.category.toLowerCase()}`}
                    aria-hidden="true"
                  >
                    <div className="document-mini-sheet">
                      <span className="document-mini-kicker">
                        {document.category === "Research"
                          ? "RESEARCH NOTES"
                          : document.category === "Guides"
                            ? "TEAM PLAYBOOK"
                            : "WORKING BRIEF"}
                      </span>
                      <strong>{document.title}</strong>
                      <span className="document-mini-rule" />
                      <span className="document-mini-line" />
                      <span className="document-mini-line short" />
                      <span className="document-mini-line" />
                      <span className="document-mini-spacer" />
                      <span className="document-mini-line medium" />
                      <span className="document-mini-line" />
                      <span className="document-mini-line short" />
                    </div>
                    <span
                      className={`document-status document-status-${document.status.toLowerCase().replaceAll(" ", "-")}`}
                    >
                      {document.status}
                    </span>
                  </div>
                  <div className="document-card-details">
                    <div className="document-card-category">
                      <FileText size={13} />
                      {document.category}
                      <ArrowUpRight size={14} />
                    </div>
                    <h3>{document.title}</h3>
                    <p>{document.room}</p>
                    <div className="document-card-footer">
                      <span className="document-author-avatar">
                        {document.author.slice(0, 2)}
                      </span>
                      <span>{document.author}</span>
                      <time>{document.updated}</time>
                    </div>
                  </div>
                </Button>
              ))}
            </div>
            {visible.length === 0 && (
              <div className="documents-empty">
                <Search size={25} />
                <h3>No documents found</h3>
                <p>Try another search or filter.</p>
                <Button
                  variant="outline"
                  onClick={() => {
                    setSearch("");
                    setCategory("All documents");
                  }}
                >
                  Clear filters
                </Button>
              </div>
            )}
            <p className="documents-preview-note">
              UI preview · sample documents and edits stay in this session.
            </p>
          </section>
        </TabsContent>
        <TabsContent value="templates">
          <section aria-label="Document templates">
            <div className="documents-summary">
              <div className="documents-summary-icon">
                <FileText size={22} />
              </div>
              <div>
                <h2>
                  A head start for your next document{" "}
                  <span>{documentTemplates.length} templates</span>
                </h2>
                <p>
                  Everyday office documents, with a useful structure ready to
                  make your own.
                </p>
              </div>
            </div>
            <div className="documents-toolbar">
              <div className="documents-results">
                <span>
                  Browse templates <span>{visibleTemplates.length}</span>
                </span>
              </div>
              <div className="documents-search">
                <Search size={15} />
                <Input
                  aria-label="Search templates"
                  placeholder="Search templates…"
                  value={templateSearch}
                  onChange={(event) => setTemplateSearch(event.target.value)}
                />
                {templateSearch && (
                  <Button variant="ghost" size="sm"
                    aria-label="Clear template search"
                    onClick={() => setTemplateSearch("")}
                  >
                    <X size={13} />
                  </Button>
                )}
              </div>
            </div>
            <div className="documents-grid">
              {visibleTemplates.map((template) => (
                <Button variant="ghost" size="sm"
                  key={template.id}
                  className="document-card document-template-card h-auto items-stretch justify-start whitespace-normal p-0"
                  onClick={() => createFromTemplate(template)}
                  aria-label={`Use ${template.title} template`}
                >
                  <div className="document-card-details">
                    <div className="documents-summary-icon">
                      <FileText size={22} />
                    </div>
                    <div className="document-card-category">
                      {template.category}
                    </div>
                    <h3>{template.title}</h3>
                    <p>{template.description}</p>
                    <div className="document-card-footer">
                      <span>Use template</span>
                      <ArrowUpRight size={14} />
                    </div>
                  </div>
                </Button>
              ))}
            </div>
            {visibleTemplates.length === 0 && (
              <div className="documents-empty">
                <Search size={25} />
                <h3>No templates found</h3>
                <p>Try a different document name or category.</p>
                <Button variant="outline" onClick={() => setTemplateSearch("")}>
                  Clear search
                </Button>
              </div>
            )}
            <p className="documents-preview-note">
              Choose a template, customize it, and save a copy to Your
              documents. Templates stay unchanged.
            </p>
          </section>
        </TabsContent>
      </Tabs>
      <Dialog
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <DialogContent className="document-preview-dialog sm:max-w-2xl">
          <DialogHeader>
            <div className="document-preview-kicker">
              <FileText size={15} />
              {selected?.category}
              <span>{selected?.status}</span>
            </div>
            <DialogTitle>
              {editing
                ? isNew
                  ? "New document"
                  : "Edit document"
                : selected?.title}
            </DialogTitle>
            <DialogDescription>
              {selected?.room} · {selected?.author} · Local preview
            </DialogDescription>
          </DialogHeader>
          {editing ? (
            <form className="document-edit-form" onSubmit={saveDocument}>
              <label htmlFor="library-document-title">Document title</label>
              <Input
                id="library-document-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={120}
                required
                autoFocus
              />
              <label htmlFor="library-document-body">Document content</label>
              <Textarea
                id="library-document-body"
                rows={13}
                value={body}
                onChange={(event) => setBody(event.target.value)}
                maxLength={20000}
                placeholder="Start with an idea…"
              />
              <div className="document-dialog-actions">
                <Button
                  variant="ghost"
                  type="button"
                  onClick={() => {
                    if (isNew) setSelected(null);
                    else setEditing(false);
                  }}
                >
                  Cancel
                </Button>
                <Button type="submit">Save document</Button>
              </div>
            </form>
          ) : (
            <>
              <div className="document-preview-body">
                {selected?.body ? (
                  selected.body
                    .split("\n\n")
                    .map((paragraph, index) => <p key={index}>{paragraph}</p>)
                ) : (
                  <p className="document-empty-copy">
                    This document is ready for your ideas. Select Edit document
                    to get started.
                  </p>
                )}
              </div>
              <div className="document-dialog-actions">
                <Button variant="outline" onClick={() => setSelected(null)}>
                  Close
                </Button>
                <Button
                  onClick={() => {
                    setTitle(selected?.title ?? "");
                    setBody(selected?.body ?? "");
                    setEditing(true);
                  }}
                >
                  <Pencil size={14} />
                  Edit document
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
