"use client";
import { agentRunErrorMessage } from '../../../../shared/agent-errors';
import { AgentOperationWarnings } from '../room/agent-operation-warnings';

import { ChoiceMenu } from "@/components/ui/choice-menu";
import { useRef, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import useSWRInfinite from "swr/infinite";
import { Activity, ChevronDown, FileText, ListTodo, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { workspaceFetch } from "@/lib/workspace-data";
import type { ActivityDetail, ActivityPage, ActivityRun, ActivityStatus } from "../../../../shared/agent-activity";
import { ViewLoading } from "./view-boundary";
import "./agent-activity.css";
import { AgentReply } from "@/components/room/private-agent-conversation";

const statusLabels: Record<ActivityStatus, string> = { queued: "Queued", running: "Running", complete: "Completed", failed: "Failed", cancelled: "Cancelled" };
const roomHref = (roomId: string) => `/room-id=${encodeURIComponent(roomId)}`;
const runKey = (run: ActivityRun) => `${run.roomId}:${run.id}`;
const dateLabel = (date: string) => new Date(date).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

function RunDetails({ base, run, userId }: { base: string; run: ActivityRun; userId: string }) {
  const { data, error, mutate } = useSWR<ActivityDetail>(
    [`${base}/${encodeURIComponent(run.roomId)}/${encodeURIComponent(run.id)}`, userId, run.updatedAt, run.status] as const,
    ([url]: readonly [string, string, string, ActivityStatus]) => workspaceFetch<ActivityDetail>(url),
    { refreshInterval: run.status === "running" || run.status === "queued" ? 5000 : 0 },
  );
  if (error) return <div role="alert"><p>Couldn’t load this request.</p><Button variant="outline" size="sm" onClick={() => void mutate()}>Retry request</Button></div>;
  if (!data) return <p role="status">Loading request…</p>;
  return <div className="agent-run-details">
    <div><h4>Your request</h4><p>{data.instruction}</p></div>
    {data.reply && <div><h4>Agent response</h4><AgentReply text={data.reply} citations={data.citations} /></div>}
    {(data.errorCode || data.error) && <p role="status" className="agent-run-error">{data.errorCode ? agentRunErrorMessage(data.errorCode, data.documents.length) : data.error}</p>}
    <AgentOperationWarnings issues={data.issues} />
    {!!data.documents.length && <div><h4>Saved documents</h4><ul>{data.documents.map((doc) => <li key={doc.versionId}><FileText size={14} />{doc.available ? <Link href={`${roomHref(run.roomId)}?${new URLSearchParams({ document: doc.documentId })}`}>{doc.title}</Link> : <span>{doc.title}</span>}<span>Version {doc.versionNumber}</span></li>)}</ul></div>}
    {!!data.tasks.length && <div><h4>Saved task changes</h4><ul>{data.tasks.map((task, index) => <li key={`${task.taskId}:${task.revision}:${index}`}><ListTodo size={14} /><span>{task.title}</span><span>Revision {task.revision}{!task.available ? " · Deleted" : ""}</span></li>)}</ul><Link href="/kanban">Open task list</Link></div>}
    {(run.startedAt || run.finishedAt) && <p className="agent-run-meta">{run.startedAt && `Started ${dateLabel(run.startedAt)}`}{run.startedAt && run.finishedAt && " · "}{run.finishedAt && `Finished ${dateLabel(run.finishedAt)}`}</p>}
    <Link href={roomHref(run.roomId)}>Open room</Link>
  </div>;
}

function RunCard({ run, base, userId }: { run: ActivityRun; base: string; userId: string }) {
  const [expanded, setExpanded] = useState(false);
  return <article className="agent-run-card" data-status={run.status}>
    <button type="button" className="agent-run-toggle" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
      <span className={`agent-run-marker ${run.status}`}><Activity size={17} /></span>
      <span className="agent-run-heading"><span className="agent-run-title">{run.title}</span><span className="agent-run-meta">{run.agentName} · {run.roomName}{run.source === "scheduled" ? " · Scheduled" : ""}</span></span>
      <span className="agent-run-summary"><Badge variant="outline">{statusLabels[run.status]}</Badge><time dateTime={run.createdAt}>{dateLabel(run.createdAt)}</time></span>
      <ChevronDown size={16} className={expanded ? "agent-run-chevron expanded" : "agent-run-chevron"} />
    </button>
    {(run.documentCount > 0 || run.taskCount > 0) && <p className="agent-run-changes">{[run.documentCount > 0 && `${run.documentCount} saved document version${run.documentCount === 1 ? "" : "s"}`, run.taskCount > 0 && `${run.taskCount} task change${run.taskCount === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}</p>}
    {expanded && <RunDetails base={base} run={run} userId={userId} />}
  </article>;
}

export function AgentActivity({ organizationId, userId }: { organizationId: string; userId: string }) {
  const base = `/api/organizations/${encodeURIComponent(organizationId)}/activity`;
  const [roomId, setRoomId] = useState("");
  const [agentId, setAgentId] = useState("");
  const [status, setStatus] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const invalidDates = !!from && !!to && from > to;
  const [historyCursor, setHistoryCursor] = useState<string | null | undefined>(undefined);
  const [syncingHistory, setSyncingHistory] = useState(false);
  const [historyError, setHistoryError] = useState(false);
  const historyInFlight = useRef(false);
  const { data, error, mutate, size, setSize, isValidating } = useSWRInfinite<ActivityPage>(
    (_index, previous: ActivityPage | null) => {
      if (invalidDates || (previous && !previous.nextCursor)) return null;
      const params = new URLSearchParams();
      if (roomId) params.set("roomId", roomId);
      if (agentId) params.set("agentId", agentId);
      if (status) params.set("status", status);
      if (from) params.set("from", new Date(`${from}T00:00:00`).toISOString());
      if (to) { const end = new Date(`${to}T00:00:00`); end.setDate(end.getDate() + 1); params.set("to", new Date(end.getTime() - 1).toISOString()); }
      if (previous?.nextCursor) params.set("cursor", previous.nextCursor);
      return [`${base}?${params}`, userId] as const;
    },
    ([url]: readonly [string, string]) => workspaceFetch<ActivityPage>(url),
    { refreshInterval: 10_000, revalidateOnFocus: true },
  );
  async function loadHistory() {
    if (historyInFlight.current || historyCursor === null) return;
    historyInFlight.current = true;
    setSyncingHistory(true);
    setHistoryError(false);
    try {
      const query = historyCursor ? `?${new URLSearchParams({ after: historyCursor })}` : "";
      const response = await fetch(`${base}/sync${query}`, { method: "POST", credentials: "include", cache: "no-store" });
      if (!response.ok) throw new Error("Room history could not be imported.");
      const page = await response.json() as { nextCursor: string | null };
      setHistoryCursor(page.nextCursor);
      // Refresh all loaded pages without advancing the history cursor again.
      await mutate().catch(() => undefined);
    } catch {
      setHistoryError(true);
    } finally {
      historyInFlight.current = false;
      setSyncingHistory(false);
    }
  }
  const runs = [...new Map((data?.flatMap((page) => page.runs) ?? []).map((run) => [runKey(run), run])).values()];
  const first = data?.[0], hasFilters = !!(roomId || agentId || status || from || to);
  return <section className="full-panel agent-activity" aria-label="Personal agent activity">
    <div className="section-heading"><div><h2>Workspace timeline</h2><p>Your agent requests, results, and saved changes.</p></div><Badge variant="outline">Only your requests</Badge></div>
    <div className="agent-activity-filters">
      <label>Agent<ChoiceMenu label="Filter by agent" value={agentId} onValueChange={setAgentId} options={[{ value: "", label: "All agents" }, ...(first?.agents.map(({ id, name }) => ({ value: id, label: name })) ?? [])]} /></label>
      <label>Room<ChoiceMenu label="Filter by room" value={roomId} onValueChange={setRoomId} options={[{ value: "", label: "All rooms" }, ...(first?.rooms.map(({ id, name }) => ({ value: id, label: name })) ?? [])]} /></label>
      <label>Status<ChoiceMenu label="Filter by status" value={status} onValueChange={setStatus} options={[{ value: "", label: "All statuses" }, ...Object.entries(statusLabels).map(([value, label]) => ({ value, label }))]} /></label>
      <label>From<input aria-label="Activity from date" type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
      <label>To<input aria-label="Activity to date" type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
      <Button variant="outline" size="sm" disabled={isValidating || syncingHistory} onClick={() => void mutate()}><RefreshCw size={14} />Refresh</Button>
      {hasFilters && <Button variant="ghost" size="sm" onClick={() => { setRoomId(""); setAgentId(""); setStatus(""); setFrom(""); setTo(""); }}>Clear filters</Button>}
    </div>
    {invalidDates && <p role="alert">Choose an end date on or after the start date.</p>}
    <div className="agent-activity-notice">
      <p>Load past requests from your rooms, five rooms at a time.</p>
      {historyCursor !== null && <Button variant="outline" size="sm" disabled={syncingHistory} onClick={() => void loadHistory()}>{syncingHistory ? "Loading room history…" : historyError ? "Retry history import" : historyCursor ? "Load more room history" : "Load room history"}</Button>}
      {syncingHistory && <p role="status">Checking room history…</p>}
      {historyError && <p role="alert">Room history couldn’t be imported. Try again to continue from the same batch.</p>}
      {historyCursor === null && <p role="status">Room history is up to date.</p>}
    </div>
    {error && <div role="alert" className="agent-activity-notice"><p>Couldn’t load your activity.</p><Button variant="outline" onClick={() => void mutate()}>Retry activity</Button></div>}
    {!data && !error && !invalidDates && <ViewLoading />}
    {!!first?.active.length && !invalidDates && <aside className="agent-activity-live" aria-label="Working now"><h3><span />Working now</h3><ul>{first.active.map((run) => <li key={runKey(run)}><strong>{run.agentName}</strong><span>{run.status === "queued" ? "Queued" : run.activities.length ? run.activities.map((a) => `${a.agentName}: ${a.phase}${a.target ? ` · ${a.target}` : ""}`).join("; ") : "Running"}</span><Link href={roomHref(run.roomId)}>{run.roomName}</Link></li>)}</ul></aside>}
    {!invalidDates && <div className="agent-activity-list">{runs.map((run) => <RunCard key={runKey(run)} run={run} base={base} userId={userId} />)}</div>}
    {data && !runs.length && !error && !invalidDates && !syncingHistory && <div className="agent-activity-empty"><Activity size={28} /><h3>{hasFilters ? "No matching requests" : "Your agent work starts here"}</h3><p>{hasFilters ? "Try a different agent, room, status, or date range." : "Ask an agent to work in a room. Your requests and their results will appear here."}</p>{!hasFilters && <Link href="/?view=Rooms">Go to rooms</Link>}</div>}
    {!!data?.at(-1)?.nextCursor && !invalidDates && <Button variant="outline" disabled={isValidating} onClick={() => void setSize(size + 1)}>{isValidating ? "Loading…" : "Load more activity"}</Button>}
  </section>;
}
