"use client";

import { useEffect, useRef, useState } from "react";
import { flushRoomDocuments } from "@/lib/room-document-save";
import { errorMessage } from "@/lib/auth-client";
import { roomRequest, RoomRequestError, type RoomMessage, type RoomDetail } from "@/lib/room-client";

import type { ChatServerEvent, ChatUser, PrivateAgentJob, RoomAgentOption } from "../../../../shared/room-chat";

export type PendingMessage = { id: string; text: string; status: "pending" | "failed" };
export function useRoomChat(organizationId: string, roomId: string, userId: string, enabled: boolean, initialData?: Pick<RoomDetail, 'messages' | 'nextCursor'>) {
  const [agents, setAgents] = useState<RoomAgentOption[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [agentJobs, setAgentJobs] = useState<PrivateAgentJob[]>([]);
  const agentsRequested = useRef(false);
  const preparingAgent = useRef(false);
  const agentOutbox = useRef(new Map<string, { agentId: string; instruction: string }>());
  const [blocked, setBlocked] = useState(false);
  const [online, setOnline] = useState<ChatUser[]>([]);
  const [typing, setTyping] = useState<Record<string, { name: string; expiresAt: number }>>({});
  const [reads, setReads] = useState<Record<string, string>>({});
  const lastTyping = useRef(0);
  const latestTime = useRef(initialData?.messages.at(-1)?.createdAt ?? "");
  const [messages, setMessages] = useState<RoomMessage[]>(() => initialData?.messages ?? []);
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [status, setStatus] = useState("Connecting…");
  const [notice, setNotice] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(initialData?.nextCursor ?? null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const connection = useRef<WebSocket | null>(null);
  const ready = useRef(false);
  const outbox = useRef(new Map<string, string>());
  const latest = useRef<string | undefined>(initialData?.messages.at(-1)?.id);
  useEffect(() => {
    if (!enabled) return;
    let disposed = false, attempt = 0;
    let timer: ReturnType<typeof setTimeout>;
    let readTimer: ReturnType<typeof setTimeout> | undefined;
    let lastReadSent = 0;
    let heartbeat: ReturnType<typeof setInterval>;
    let lastResponse = Date.now();
    let replaying = true;
    let initialSync = true;
    let socket: WebSocket | null = null;
    const send = (event: object) => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event)); };
    const markRead = () => {
      if (disposed || document.visibilityState !== "visible" || socket?.readyState !== WebSocket.OPEN) return;
      if (readTimer !== undefined) return;
      const delay = Math.max(0, 1000 - (Date.now() - lastReadSent));
      if (delay) {
        // Keep a trailing receipt so the last message in a burst is marked read.
        readTimer = setTimeout(() => { readTimer = undefined; markRead(); }, delay);
      } else {
        lastReadSent = Date.now();
        send({ type: "read" });
      }
    };
    const merge = (incoming: RoomMessage[]) => {
      setMessages((previous) => {
        const map = new Map(previous.map((message) => [message.id, message]));
        for (const message of incoming) map.set(message.id, message);
        return [...map.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
      });
    };
    const mergeAgentJobs = (incoming: PrivateAgentJob[]) => {
      for (const job of incoming) agentOutbox.current.delete(job.id);
      setAgentJobs((previous) => {
        const jobs = new Map(previous.map((job) => [job.id, job]));
        for (const job of incoming) if ((jobs.get(job.id)?.revision ?? -1) <= job.revision) jobs.set(job.id, job);
        return [...jobs.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)).slice(-50);
      });
    };
    async function connect() {
      try {
        const { url } = await roomRequest<{ url: string }>(organizationId, `/${encodeURIComponent(roomId)}/socket-ticket`, "POST", {});
        if (disposed) return;
        lastResponse = Date.now();
        socket = new WebSocket(url); connection.current = socket;
        socket.onmessage = ({ data }) => {
          if (disposed) return;
          lastResponse = Date.now();
          const event = JSON.parse(data) as ChatServerEvent<RoomMessage>;
          if (event.type === "ready") {
            attempt = 0; replaying = true; initialSync = !latest.current;
            send({ type: "sync", requestId: "sync", cursor: latest.current });
            send({ type: "agent.history", requestId: "agent.history" });
            if (agentsRequested.current) send({ type: "agent.list", requestId: "agent.list" });
          } else if (event.type === "sync") {
            merge(event.messages);
            const last = event.messages.at(-1);
            if (last) { latest.current = last.id; latestTime.current = last.createdAt; }
            if (initialSync) setNextCursor(event.nextCursor);
            if (!initialSync && event.nextCursor) {
              send({ type: "sync", requestId: "sync", cursor: event.nextCursor });
              return;
            }
            replaying = false; ready.current = true;
            setStatus("Connected");
            markRead();
            if (agentOutbox.current.size) {
              const syncedSocket = socket;
              void flushRoomDocuments(organizationId, roomId).then(() => {
                if (disposed || socket !== syncedSocket || !ready.current) return;
                for (const [requestId, input] of agentOutbox.current) send({ type: "agent.invoke", requestId, ...input });
              }).catch((error) => { if (!disposed) setNotice(`Agent not started: ${errorMessage(error)}`); });
            }
            for (const [clientMessageId, text] of outbox.current) send({ type: "send", requestId: clientMessageId, clientMessageId, text });
          } else if (event.type === "history") {
            merge(event.messages); setNextCursor(event.nextCursor); setLoadingOlder(false);
          } else if (event.type === "message" || event.type === "ack") {
            merge([event.message]);
            if (event.message.authorUserId === userId && event.message.clientMessageId) {
              outbox.current.delete(event.message.clientMessageId);
              setPending((previous) => previous.filter((message) => message.id !== event.message.clientMessageId));
            }
            if (event.type === "ack") {
              outbox.current.delete(event.requestId);
              setPending((previous) => previous.filter((message) => message.id !== event.requestId));
            }
            if (!replaying && event.message.createdAt > latestTime.current) { latest.current = event.message.id; latestTime.current = event.message.createdAt; }
            markRead();
          } else if (event.type === "agent.list") {
            setAgents(event.agents); setAgentsLoading(false);
          } else if (event.type === "agent.history") {
            mergeAgentJobs(event.jobs);
          } else if (event.type === "agent.update") {
            mergeAgentJobs([event.job]);
            if (event.job.status === 'complete' || event.job.status === 'failed') window.dispatchEvent(new window.CustomEvent('room-document-preview', { detail: { organizationId, roomId, runId: event.job.id, input: null } }));
          } else if (event.type === 'agent.document-preview') {
            window.dispatchEvent(new window.CustomEvent('room-document-preview', { detail: { organizationId, roomId, ...event } }));
          } else if (event.type === "work.update") {
            window.dispatchEvent(new window.CustomEvent('room-work-update', { detail: { organizationId, roomId, work: event.work } }));
          } else if (event.type === "presence") {
            setOnline(event.users);
          } else if (event.type === "typing") {
            setTyping((previous) => ({ ...previous, [event.userId]: { name: event.name, expiresAt: event.expiresAt } }));
          } else if (event.type === "read") {
            setReads((previous) => ({ ...previous, [event.userId]: event.readAt }));
          } else if (event.type === "error") {
            setNotice(event.error); setLoadingOlder(false);
            if (event.requestId === "agent.list") setAgentsLoading(false);
            if (event.requestId && agentOutbox.current.has(event.requestId)) {
              agentOutbox.current.delete(event.requestId);
              setAgentJobs((previous) => previous.map((job) => job.id === event.requestId ? { ...job, status: "failed", error: event.error } : job));
            }
            if (event.requestId === "sync") {
              if (event.error === "Invalid history cursor.") {
                latest.current = undefined; latestTime.current = ""; initialSync = true;
                send({ type: "sync", requestId: "sync" });
              } else socket?.close();
            }
            if (event.requestId && outbox.current.has(event.requestId)) {
              outbox.current.delete(event.requestId);
              setPending((previous) => previous.map((message) => message.id === event.requestId ? { ...message, status: "failed" } : message));
            }
          }
        };
        socket.onclose = (event) => {
          window.dispatchEvent(new window.CustomEvent('room-document-preview', { detail: { organizationId, roomId, input: null } }));
          clearTimeout(readTimer); readTimer = undefined; lastReadSent = 0;
          ready.current = false; clearInterval(heartbeat); setLoadingOlder(false); setOnline([]); setAgentsLoading(false);
          if (disposed) return;
          if (event.code === 4003) {
            setStatus("Room access expired. Reload after access is restored."); setBlocked(true); outbox.current.clear(); agentOutbox.current.clear();
            setPending((previous) => previous.map((message) => ({ ...message, status: "failed" })));
            return;
          }
          setStatus("Reconnecting…");
          timer = setTimeout(connect, Math.min(1000 * 2 ** attempt++, 15_000));
        };
        socket.onerror = () => socket?.close();
        heartbeat = setInterval(() => {
          if (Date.now() - lastResponse > 65_000) socket?.close();
          else send({ type: "ping" });
        }, 25_000);
      } catch (error) {
        if (disposed) return;
        if (error instanceof RoomRequestError && [401, 403, 404].includes(error.status)) {
          setStatus(error.message); setBlocked(true); outbox.current.clear(); agentOutbox.current.clear();
          setPending((previous) => previous.map((message) => ({ ...message, status: "failed" })));
          return;
        }
        setStatus("Unable to connect. Retrying…");
        timer = setTimeout(connect, Math.min(1000 * 2 ** attempt++, 15_000));
      }
    }
    const typingExpiry = setInterval(() => setTyping((previous) => {
      const entries = Object.entries(previous).filter(([, user]) => user.expiresAt > Date.now());
      return entries.length === Object.keys(previous).length ? previous : Object.fromEntries(entries);
    }), 1000);
    void connect();
    document.addEventListener("visibilitychange", markRead);
    return () => { disposed = true; clearInterval(typingExpiry); clearTimeout(timer); clearTimeout(readTimer); clearInterval(heartbeat); socket?.close(); connection.current = null; ready.current = false; document.removeEventListener("visibilitychange", markRead); };
  }, [organizationId, roomId, userId, enabled]);
  function sendMessage(text: string, retryId?: string) {
    if (!enabled || blocked) return false;
    const id = retryId ?? crypto.randomUUID();
    outbox.current.set(id, text);
    setPending((previous) => [...previous.filter((message) => message.id !== id), { id, text, status: "pending" }]);
    if (ready.current && connection.current?.readyState === WebSocket.OPEN) connection.current.send(JSON.stringify({ type: "send", requestId: id, clientMessageId: id, text }));
    return true;
  }
  function loadOlder() {
    if (!nextCursor || loadingOlder || connection.current?.readyState !== WebSocket.OPEN) return;
    setLoadingOlder(true);
    connection.current.send(JSON.stringify({ type: "history", cursor: nextCursor }));
  }
  function loadAgents() {
    agentsRequested.current = true;
    if (!enabled || blocked) return;
    if (connection.current?.readyState !== WebSocket.OPEN) { setNotice("Connect to room chat before choosing an agent."); return; }
    setAgentsLoading(true);
    connection.current.send(JSON.stringify({ type: "agent.list", requestId: "agent.list" }));
  }
  async function invokeAgent(agent: RoomAgentOption, instruction: string) {
    if (!enabled || blocked || !instruction.trim() || preparingAgent.current) return false;
    if (agentJobs.filter((job) => job.status === "queued" || job.status === "running").length >= 20) { setNotice("Wait for some queued requests to finish."); return false; }
    preparingAgent.current = true;
    try {
      await flushRoomDocuments(organizationId, roomId);
      const id = crypto.randomUUID(), now = new Date().toISOString();
      agentOutbox.current.set(id, { agentId: agent.id, instruction: instruction.trim() });
      setAgentJobs((previous) => [...previous, { id, agentId: agent.id, agentName: agent.name, instruction: instruction.trim(), reply: "", status: "queued", createdAt: now, updatedAt: now, revision: -1 }]);
      if (ready.current && connection.current?.readyState === WebSocket.OPEN) connection.current.send(JSON.stringify({ type: "agent.invoke", requestId: id, agentId: agent.id, instruction: instruction.trim() }));
      return true;
    } catch (error) { setNotice(`Agent not started: ${errorMessage(error)}`); return false; }
    finally { preparingAgent.current = false; }
  }
  function sendTyping() {
    if (Date.now() - lastTyping.current < 2000 || connection.current?.readyState !== WebSocket.OPEN) return;
    lastTyping.current = Date.now();
    connection.current.send(JSON.stringify({ type: "typing" }));
  }
  function cancelAgent(jobId: string) {
    if (connection.current?.readyState === WebSocket.OPEN) connection.current.send(JSON.stringify({ type: 'agent.cancel', jobId }));
  }
  return { agents, agentsLoading, agentJobs, loadAgents, invokeAgent, cancelAgent, canSend: enabled && !blocked, online, typing, reads, sendTyping, messages, pending, status, notice, setNotice, nextCursor, loadingOlder, loadOlder, sendMessage };
}
