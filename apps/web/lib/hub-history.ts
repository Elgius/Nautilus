export type HubTurn = {
  id: string;
  conversationId: string;
  agentId: string;
  createdAt: number;
  prompt: string;
  reply: string;
};

export function historyPrefix(userId: string, organizationId: string) {
  return `nautilus:agent-chat:v1:${encodeURIComponent(userId)}:${encodeURIComponent(organizationId)}:`;
}

export function readHistory(prefix: string): HubTurn[] {
  const turns: HubTurn[] = [];
  const storage = window.localStorage;
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key?.startsWith(prefix)) continue;
    let turn;
    try { turn = JSON.parse(storage.getItem(key) ?? "null"); }
    catch { continue; }
    if (turn && typeof turn.id === "string" && key === prefix + turn.id &&
      typeof turn.conversationId === "string" && typeof turn.agentId === "string" &&
      typeof turn.createdAt === "number" && typeof turn.prompt === "string" && typeof turn.reply === "string") turns.push(turn);
  }
  return turns;
}

export type HubSummary = { id: string; agentId: string; title: string; preview: string; lastId: string; updatedAt: number };
export type HubPage = { summaries: HubSummary[]; next: string | null };
export class HubSessionChanged extends Error {}

export async function hubFetch(url: string, userId: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("X-Hub-User", userId);
  const response = await fetch(url, { ...init, headers, credentials: "include", cache: "no-store" });
  if ([401, 403, 404].includes(response.status)) throw new HubSessionChanged();
  return response;
}

export async function importHubHistory(url: string, userId: string, organizationId: string, signal: AbortSignal) {
  const prefix = historyPrefix(userId, organizationId);
  let legacy: HubTurn[] = [];
  try { legacy = readHistory(prefix); } catch { /* Browser storage may be disabled. */ }
  let importError = "";
  for (const turn of legacy) {
    const response = await hubFetch(url, userId, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...turn, userId }), signal,
    });
    if (!response.ok) {
      importError = "Some browser chats couldn’t be imported. Their local copies are still available.";
      continue;
    }
    window.localStorage.removeItem(prefix + turn.id);
  }
  return importError;
}
