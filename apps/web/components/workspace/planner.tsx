"use client";

import { useCallback, useMemo, useState, useSyncExternalStore, type FormEvent } from "react";
import { CalendarDays, Circle, CircleCheck, CircleDashed, CircleDot, Columns3, List, ListFilter, Plus, Search, SlidersHorizontal, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TaskCalendar } from "./task-calendar";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

const statusIcons = { "To do": Circle, "In progress": CircleDot, "In review": CircleDashed, Done: CircleCheck };
const statuses = ["To do", "In progress", "In review", "Done"] as const;
type Status = typeof statuses[number];
export type Task = { id: string; title: string; description: string; status: Status; date: string };
const selectClass = "h-8 w-full rounded-lg border border-input bg-background px-2 text-sm focus-visible:outline-ring";
const storageEvent = "nautilus-planner-change";
function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(storageEvent, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(storageEvent, callback);
  };
}
function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function parseTasks(raw: string | null): Task[] {
  if (!raw) return [];
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value) || !value.every((item) => item && typeof item.id === "string" && typeof item.title === "string" && typeof item.description === "string" && statuses.includes(item.status) && typeof item.date === "string" && (!item.date || /^\d{4}-\d{2}-\d{2}$/.test(item.date)))) {
    throw new Error("Saved tasks could not be read.");
  }
  return value;
}

export function Planner({ mode, storageKey }: { mode: "Kanban" | "Calendar"; storageKey: string }) {
  const getSnapshot = useCallback(() => {
    try { return window.localStorage.getItem(storageKey); }
    catch { return "unavailable"; }
  }, [storageKey]);
  const raw = useSyncExternalStore(subscribe, getSnapshot, () => null);
  const { tasks, readError } = useMemo(() => {
    try { return { tasks: parseTasks(raw), readError: "" }; }
    catch { return { tasks: [] as Task[], readError: "Saved tasks are unavailable. Check browser storage and reload before making changes." }; }
  }, [raw]);
  const [draft, setDraft] = useState<Task | null>(null);
  const [error, setError] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [dragging, setDragging] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [layout, setLayout] = useState("board");
  const [statusFilter, setStatusFilter] = useState("All tasks");
  const [fields, setFields] = useState({ description: false, status: true, date: true });
  const [dropTarget, setDropTarget] = useState<Status | null>(null);
  const filtered = tasks.filter((task) => (statusFilter === "All tasks" || task.status === statusFilter) && `${task.title} ${task.description}`.toLowerCase().includes(query.toLowerCase()));

  function update(change: (current: Task[]) => Task[], message: string) {
    try {
      const current = parseTasks(window.localStorage.getItem(storageKey));
      window.localStorage.setItem(storageKey, JSON.stringify(change(current)));
      window.dispatchEvent(new Event(storageEvent));
      setError("");
      setAnnouncement(message);
      return true;
    } catch {
      setError("Your changes could not be saved. Check that browser storage is available and try again.");
      return false;
    }
  }
  function add(status: Status = "To do", date = mode === "Calendar" ? dateKey(new Date()) : "") {
    setDraft({ id: crypto.randomUUID(), title: "", description: "", status, date });
  }
  function move(id: string, status: Status) {
    update((current) => current.map((task) => task.id === id ? { ...task, status } : task), `Task moved to ${status}.`);
  }
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft?.title.trim()) return;
    const saved = { ...draft, title: draft.title.trim(), description: draft.description.trim() };
    if (update((current) => current.some((task) => task.id === saved.id) ? current.map((task) => task.id === saved.id ? saved : task) : [...current, saved], "Task saved.")) setDraft(null);
  }
  function taskCard(task: Task) {
    const StatusIcon = statusIcons[task.status];
    const isBoard = mode === "Kanban";
    return (
      <article key={task.id} draggable onDragStart={(event) => { event.dataTransfer.setData("text/plain", task.id); event.dataTransfer.effectAllowed = "move"; setDragging(task.id); }} onDragEnd={() => { setDragging(null); setDropTarget(null); }} className={`group rounded-xl border border-border/80 bg-card p-4 shadow-sm transition-[box-shadow,opacity] hover:shadow-md ${dragging === task.id ? "opacity-40" : ""}`}>
        <div className="mb-3 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span className="font-medium tracking-wide">TASK-{task.id.slice(0, 6).toUpperCase()}</span>
          {task.date && (!isBoard || fields.date) && <time dateTime={task.date} className="flex items-center gap-1.5"><CalendarDays className="size-3" />{new Date(`${task.date}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</time>}
        </div>
        <button type="button" onClick={() => setDraft({ ...task })} className="block w-full break-words text-left text-sm font-medium leading-relaxed hover:text-primary focus-visible:outline-ring">{task.title}</button>
        {task.description && (!isBoard || fields.description) && <p className="mt-2 line-clamp-3 whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">{task.description}</p>}
        {(!isBoard || fields.status) && <div className="mt-4 flex items-center gap-1.5"><StatusIcon aria-hidden="true" className="size-3.5 shrink-0 text-primary" /><select aria-label={`Status for ${task.title}`} className="h-7 max-w-full rounded-md border border-border/70 bg-card px-2 text-xs text-foreground focus-visible:outline-ring" value={task.status} onChange={(event) => move(task.id, event.target.value as Status)}>{statuses.map((status) => <option key={status}>{status}</option>)}</select></div>}
      </article>
    );
  }
  return (
    <section className="space-y-6">
      <div className="page-heading">
        <div><div className="eyebrow"><span /> YOUR TEAM, IN SYNC</div><h1>{mode === "Kanban" ? "Your team’s work." : "Your team’s calendar."}</h1><p>{mode === "Kanban" ? "Organize tasks and move work forward, one card at a time." : "Plan your days and keep task due dates in view."}</p></div>
        <Button onClick={() => add()} disabled={!!readError}><Plus />Add task</Button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-5">
        {<DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline" />}><ListFilter />{statusFilter === "All tasks" ? "Filters and views" : statusFilter}{statusFilter !== "All tasks" && <span className="size-1.5 rounded-full bg-primary" />}</DropdownMenuTrigger>
          <DropdownMenuContent className="w-52"><DropdownMenuGroup><DropdownMenuLabel>Filter by status</DropdownMenuLabel><DropdownMenuRadioGroup value={statusFilter} onValueChange={setStatusFilter}>{["All tasks", ...statuses].map((status) => <DropdownMenuRadioItem closeOnClick key={status} value={status}>{status}</DropdownMenuRadioItem>)}</DropdownMenuRadioGroup></DropdownMenuGroup></DropdownMenuContent>
        </DropdownMenu>}
        <div className="ml-auto flex w-full max-w-full items-center justify-end gap-2 sm:w-auto sm:flex-1">
          <div className="relative w-full sm:max-w-72"><Search aria-hidden="true" className="absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" /><Input aria-label="Search tasks" placeholder="Search tasks…" className="pl-9" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
          {mode === "Kanban" && <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" />}><SlidersHorizontal />Display</DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64 p-2">
              <DropdownMenuGroup><DropdownMenuLabel>Layout</DropdownMenuLabel><DropdownMenuRadioGroup value={layout} onValueChange={setLayout} className="grid grid-cols-2 gap-2 p-1"><DropdownMenuRadioItem closeOnClick value="list" className="flex-col rounded-lg border py-4"><List />List</DropdownMenuRadioItem><DropdownMenuRadioItem closeOnClick value="board" className="flex-col rounded-lg border py-4"><Columns3 />Board</DropdownMenuRadioItem></DropdownMenuRadioGroup></DropdownMenuGroup>
              <DropdownMenuSeparator /><DropdownMenuGroup><DropdownMenuLabel>Card properties</DropdownMenuLabel>{([['status', 'Status'], ['date', 'Due date'], ['description', 'Description']] as const).map(([key, label]) => <DropdownMenuCheckboxItem key={key} checked={fields[key]} closeOnClick={false} onCheckedChange={(checked) => setFields((current) => ({ ...current, [key]: checked }))} className="py-2.5">{label}</DropdownMenuCheckboxItem>)}</DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>}
        </div>
      </div>
      {(error || readError) && <p role="alert" className="text-sm text-destructive">{error || readError}</p>}
      <p role="status" className="sr-only">{announcement}</p>
      {mode === "Kanban" ? (
        <div className={layout === "board" ? "flex items-stretch gap-4 overflow-x-auto pb-3" : "space-y-4"}>
          {statuses.filter((status) => statusFilter === "All tasks" || statusFilter === status).map((status) => {
            const cards = filtered.filter((task) => task.status === status);
            const StatusIcon = statusIcons[status];
            return <section key={status} aria-label={status} onDragOver={(event) => { if (dragging) { event.preventDefault(); setDropTarget(status); } }} onDrop={(event) => { event.preventDefault(); if (dragging && event.dataTransfer.getData("text/plain") === dragging) move(dragging, status); setDragging(null); setDropTarget(null); }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null); }} className={`rounded-2xl border p-3 transition-colors ${layout === "board" ? "min-h-[max(420px,calc(100dvh-310px))] min-w-[280px] flex-1" : ""} ${dropTarget === status ? "border-primary/50 bg-primary/10" : "border-border/40 bg-muted"}`}>
              <div className="mb-3 flex items-center gap-2 px-1"><StatusIcon aria-hidden="true" className="size-4 text-primary" /><h2 className="text-sm font-semibold">{status}</h2><Badge variant="outline" className="rounded-md bg-card font-normal">{cards.length}</Badge><Button variant="ghost" size="icon-sm" className="ml-auto" aria-label={`Add task to ${status}`} onClick={() => add(status)} disabled={!!readError}><Plus /></Button></div>
              <div className="space-y-3">{cards.map(taskCard)}{cards.length === 0 && <div className="rounded-xl border border-dashed border-border/80 px-4 py-8 text-center"><StatusIcon aria-hidden="true" className="mx-auto mb-3 size-6 text-primary/40" /><p className="text-xs text-muted-foreground">{query ? "No matching tasks." : "No tasks yet"}</p><Button variant="ghost" size="sm" className="mt-2 text-xs text-muted-foreground" onClick={() => add(status)} disabled={!!readError}><Plus />Add task</Button></div>}</div>
            </section>;
          })}
        </div>
      ) : (
        <TaskCalendar tasks={filtered} disabled={!!readError} onAdd={(date) => add("To do", date)} onEdit={(task) => setDraft({ ...task })} />
      )}
      <p className="text-xs text-muted-foreground">Saved in this browser · Personal to this workspace</p>
      <Dialog open={draft !== null} onOpenChange={(open) => { if (!open) setDraft(null); }}>
        <DialogContent><DialogHeader><DialogTitle>{tasks.some((task) => task.id === draft?.id) ? "Edit task" : "Add task"}</DialogTitle><DialogDescription>Track work on the board and add a due date to show it on your calendar.</DialogDescription></DialogHeader>
          {draft && <form onSubmit={save} className="space-y-4">
            <label className="block space-y-2 text-sm font-medium">Title<Input autoFocus required maxLength={200} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
            <label className="block space-y-2 text-sm font-medium">Description<Textarea maxLength={4000} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
            <div className="grid grid-cols-2 gap-4"><label className="space-y-2 text-sm font-medium">Status<select className={selectClass} value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as Status })}>{statuses.map((status) => <option key={status}>{status}</option>)}</select></label><label className="space-y-2 text-sm font-medium">Due date<Input type="date" value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} /></label></div>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <div className="flex flex-wrap justify-end gap-2">{tasks.some((task) => task.id === draft.id) && <Button type="button" variant="destructive" className="mr-auto" onClick={() => { if (update((current) => current.filter((task) => task.id !== draft.id), "Task deleted.")) setDraft(null); }}><Trash2 />Delete</Button>}<Button type="button" variant="outline" onClick={() => setDraft(null)}>Cancel</Button><Button type="submit" disabled={!draft.title.trim()}>Save task</Button></div>
          </form>}
        </DialogContent>
      </Dialog>
    </section>
  );
}
