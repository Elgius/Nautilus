"use client";

import { useCallback, useMemo, useState, useSyncExternalStore, type FormEvent } from "react";
import { CalendarDays, GripVertical, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const statuses = ["To do", "In progress", "In review", "Done"] as const;
type Status = typeof statuses[number];
type Task = { id: string; title: string; description: string; status: Status; date: string };
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
  const [selected, setSelected] = useState(() => new Date());
  const [month, setMonth] = useState(() => new Date());
  const [draft, setDraft] = useState<Task | null>(null);
  const [error, setError] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [dragging, setDragging] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const filtered = tasks.filter((task) => `${task.title} ${task.description}`.toLowerCase().includes(query.toLowerCase()));
  const scheduled = filtered.filter((task) => task.date === dateKey(selected));

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
  function add(status: Status = "To do") {
    setDraft({ id: crypto.randomUUID(), title: "", description: "", status, date: mode === "Calendar" ? dateKey(selected) : "" });
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
    return (
      <article key={task.id} draggable onDragStart={(event) => { event.dataTransfer.setData("text/plain", task.id); event.dataTransfer.effectAllowed = "move"; setDragging(task.id); }} onDragEnd={() => setDragging(null)} className="rounded-xl border bg-card p-4 shadow-sm">
        <div className="flex items-start gap-2">
          <GripVertical aria-hidden="true" className="mt-1 size-4 shrink-0 text-muted-foreground" />
          <button type="button" onClick={() => setDraft({ ...task })} className="min-w-0 flex-1 break-words text-left text-sm font-medium hover:underline focus-visible:outline-ring">{task.title}</button>
        </div>
        {task.description && <p className="mt-2 line-clamp-3 whitespace-pre-wrap break-words text-xs text-muted-foreground">{task.description}</p>}
        {task.date && <p className="mt-3 flex items-center gap-1 text-xs text-muted-foreground"><CalendarDays className="size-3" /><time dateTime={task.date}>{new Date(`${task.date}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</time></p>}
        <select aria-label={`Status for ${task.title}`} className={`${selectClass} mt-3`} value={task.status} onChange={(event) => move(task.id, event.target.value as Status)}>{statuses.map((status) => <option key={status}>{status}</option>)}</select>
      </article>
    );
  }
  return (
    <section className="space-y-6">
      <div className="page-heading">
        <div><div className="eyebrow"><span /> YOUR TEAM, IN SYNC</div><h1>{mode === "Kanban" ? "A clear path from to do to done." : "Make time for what’s next."}</h1><p>{mode === "Kanban" ? "Organize tasks and move work forward, one card at a time." : "Plan your days and keep task due dates in view."}</p></div>
        <Button onClick={() => add()} disabled={!!readError}><Plus />Add task</Button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3"><Input aria-label="Search tasks" placeholder="Search tasks…" className="max-w-sm" value={query} onChange={(event) => setQuery(event.target.value)} /><p className="text-xs text-muted-foreground">Saved in this browser · Personal to this workspace</p></div>
      {(error || readError) && <p role="alert" className="text-sm text-destructive">{error || readError}</p>}
      <p role="status" className="sr-only">{announcement}</p>
      {mode === "Kanban" ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {statuses.map((status) => {
            const cards = filtered.filter((task) => task.status === status);
            return <section key={status} aria-label={status} onDragOver={(event) => { if (dragging) event.preventDefault(); }} onDrop={(event) => { event.preventDefault(); if (dragging && event.dataTransfer.getData("text/plain") === dragging) move(dragging, status); setDragging(null); }} className="min-h-72 rounded-xl border bg-muted/40 p-3">
              <div className="mb-4 flex items-center gap-2"><h2 className="text-sm font-semibold">{status}</h2><Badge variant="secondary">{cards.length}</Badge><Button variant="ghost" size="icon-sm" className="ml-auto" aria-label={`Add task to ${status}`} onClick={() => add(status)} disabled={!!readError}><Plus /></Button></div>
              <div className="space-y-3">{cards.map(taskCard)}{cards.length === 0 && <p className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">{query ? "No matching tasks." : "Add a task or move one here."}</p>}</div>
            </section>;
          })}
        </div>
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(280px,1fr)]">
          <div className="min-w-0 rounded-xl border bg-card p-2 sm:p-5">
            <div className="mb-2 flex items-center justify-between px-2"><h2 className="font-semibold">Task calendar</h2><Button variant="outline" onClick={() => { const today = new Date(); setSelected(today); setMonth(today); }}>Today</Button></div>
            <Calendar mode="single" required selected={selected} onSelect={setSelected} month={month} onMonthChange={setMonth} className="w-full [--cell-size:clamp(2rem,5vw,4rem)]" classNames={{ root: "w-full" }} modifiers={{ scheduled: (date) => filtered.some((task) => task.date === dateKey(date)) }} modifiersClassNames={{ scheduled: "after:pointer-events-none after:absolute after:bottom-1 after:left-1/2 after:z-20 after:size-1 after:-translate-x-1/2 after:rounded-full after:bg-primary" }} />
            <p className="px-3 pb-2 text-xs text-muted-foreground">Dots mark days with tasks. Select a day to see its agenda.</p>
          </div>
          <section className="space-y-4"><div className="flex items-center justify-between gap-2"><h2 className="font-semibold">{selected.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</h2><Badge variant="secondary">{scheduled.length} tasks</Badge></div>{scheduled.map(taskCard)}{scheduled.length === 0 && <div className="rounded-xl border border-dashed p-8 text-center"><CalendarDays className="mx-auto mb-3 size-8 text-muted-foreground" /><p className="text-sm text-muted-foreground">{query ? "No matching tasks for this day." : "Nothing scheduled. Give your next task a date."}</p><Button variant="outline" className="mt-4" onClick={() => add()} disabled={!!readError}><Plus />Add task</Button></div>}<p className="text-xs text-muted-foreground">Tasks without a due date are available on the Kanban board.</p></section>
        </div>
      )}
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
