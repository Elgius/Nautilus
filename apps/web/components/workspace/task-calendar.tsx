"use client";

import { useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Plus, Table2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { TaskSchedule } from '@/lib/planner-client';
import type { Task } from "./planner";

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function TaskCalendar({ tasks, schedules, disabled, onAdd, onEdit }: {
  tasks: Task[];
  schedules: TaskSchedule[];
  disabled: boolean;
  onAdd: (date: string) => void;
  onEdit: (task: Task) => void;
}) {
  const [month, setMonth] = useState(() => new Date());
  const [view, setView] = useState<"calendar" | "table">("calendar");
  const today = dateKey(new Date());
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const dayCount = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const weekCount = Math.ceil((first.getDay() + dayCount) / 7);
  const weeks = Array.from({ length: weekCount }, (_, week) =>
    Array.from({ length: 7 }, (_, day) => new Date(month.getFullYear(), month.getMonth(), 1 - first.getDay() + week * 7 + day)),
  );
  const monthLabel = month.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const ordered = [...tasks].sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999") || a.title.localeCompare(b.title));

  return (
    <section aria-label="Task calendar" className="min-w-0">
      <div className="flex items-center gap-5 border-b" aria-label="Calendar view">
        {([{ value: "table", label: "Table", icon: Table2 }, { value: "calendar", label: "Calendar", icon: CalendarDays }] as const).map(({ value, label, icon: Icon }) => (
          <button key={value} type="button" aria-pressed={view === value} onClick={() => setView(value)} className={`flex items-center gap-2 border-b-2 px-1 pb-3 text-sm font-medium focus-visible:outline-ring ${view === value ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}><Icon className="size-4" />{label}</button>
        ))}
      </div>
      {view === "calendar" ? <>
        <div className="flex flex-wrap items-center justify-between gap-3 py-4">
          <h2 aria-live="polite" className="text-sm font-semibold">{monthLabel}</h2>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon-sm" aria-label="Previous month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft /></Button>
            <Button variant="ghost" size="sm" onClick={() => setMonth(new Date())}>Today</Button>
            <Button variant="ghost" size="icon-sm" aria-label="Next month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight /></Button>
          </div>
        </div>
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full min-w-[700px] table-fixed border-collapse" aria-label={monthLabel}>
            <thead><tr>{["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((day) => <th key={day} scope="col" className="border-b bg-muted/30 py-3 text-center text-xs font-normal text-muted-foreground"><abbr title={day} className="no-underline">{day.slice(0, 3)}</abbr></th>)}</tr></thead>
            <tbody>{weeks.map((week) => <tr key={dateKey(week[0])}>{week.map((date) => {
              const key = dateKey(date);
              const outside = date.getMonth() !== month.getMonth();
              const dayTasks = ordered.filter((task) => task.date === key);
              const label = date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
              return <td key={key} className={`group h-[clamp(125px,16vh,180px)] border-r border-b border-border/70 p-1.5 align-top last:border-r-0 ${outside ? "bg-muted/35" : "bg-card"}`}>
                <div className="mb-2 flex items-center justify-between gap-1">
                  <Button variant="ghost" size="icon-sm" aria-label={`Add task on ${label}`} disabled={disabled} onClick={() => onAdd(key)} className="text-muted-foreground opacity-0 focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"><Plus className="size-3.5" /></Button>
                  <button type="button" aria-label={`Add task for ${label}`} aria-current={key === today ? "date" : undefined} disabled={disabled} onClick={() => onAdd(key)} className={`flex min-h-7 min-w-7 items-center justify-center rounded-full px-1.5 text-xs focus-visible:outline-ring disabled:opacity-50 ${key === today ? "bg-primary font-semibold text-primary-foreground" : outside ? "text-muted-foreground hover:bg-muted" : "text-foreground hover:bg-muted"}`}>
                    {date.getDate() === 1 ? date.toLocaleDateString(undefined, { month: "short", day: "numeric" }) : date.getDate()}
                  </button>
                </div>
                <div className="space-y-1.5">{schedules.filter((schedule) => dateKey(new Date(schedule.scheduledAt)) === key && schedule.state !== 'cancelled').map((schedule) => {
                  const task = tasks.find((task) => task.id === schedule.event.taskId);
                  return task ? <button type="button" key={schedule.id} onClick={() => onEdit(task)} className="block w-full truncate rounded-md border border-dashed border-primary/40 bg-primary/5 px-2 py-1.5 text-left text-xs" title="Private scheduled execution">Run {new Date(schedule.scheduledAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })} · {task.title}</button> : null;
                })}{dayTasks.map((task) => <button key={task.id} type="button" onClick={() => onEdit(task)} title={`${task.title} · ${task.status}`} className={`block w-full truncate rounded-md border px-2 py-1.5 text-left text-xs font-medium shadow-sm transition-colors focus-visible:outline-ring ${task.status === "In progress" ? "border-primary/20 bg-primary/10 text-primary hover:bg-primary/15" : "border-border bg-card text-card-foreground hover:bg-muted"}`}><span className={task.status === "Done" ? "text-muted-foreground line-through" : undefined}>{task.title}</span></button>)}</div>
              </td>;
            })}</tr>)}</tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">Select a date to add a task, or a task to edit it. Dashed entries show your scheduled agent execution times; solid entries show due dates. Undated tasks appear in Table and on the Kanban board.</p>
      </> : <div className="mt-4 overflow-x-auto rounded-xl border bg-card">
        <table className="w-full min-w-[540px] text-left text-sm" aria-label="Tasks table">
          <thead className="border-b bg-muted/40 text-xs text-muted-foreground"><tr><th scope="col" className="p-3 font-medium">Task</th><th scope="col" className="p-3 font-medium">Status</th><th scope="col" className="p-3 font-medium">Due date</th></tr></thead>
          <tbody>{ordered.map((task) => <tr key={task.id} className="border-b last:border-0"><td className="p-3"><button type="button" onClick={() => onEdit(task)} className="text-left font-medium break-words hover:text-primary focus-visible:outline-ring">{task.title}</button></td><td className="whitespace-nowrap p-3 text-muted-foreground">{task.status}</td><td className="whitespace-nowrap p-3 text-muted-foreground">{task.date ? <time dateTime={task.date}>{new Date(`${task.date}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</time> : "No due date"}</td></tr>)}{ordered.length === 0 && <tr><td colSpan={3} className="p-8 text-center text-muted-foreground">No matching tasks. Add a task or adjust your filters.</td></tr>}</tbody>
        </table>
      </div>}
    </section>
  );
}
