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

export async function loadHubHistory(organizationId: string, userId: string, signal: AbortSignal) {
  const url = `/api/organizations/${encodeURIComponent(organizationId)}/agent-hub-history`;
  const prefix = historyPrefix(userId, organizationId);
  let legacy: HubTurn[] = [];
  try { legacy = readHistory(prefix); } catch { /* Browser storage may be disabled. */ }
  let importError = "";
  for (const turn of legacy) {
    const response = await fetch(url, {
      method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...turn, userId }), signal,
    });
    if (!response.ok) {
      importError = "Some browser chats couldn’t be imported. Their local copies are still available.";
      continue;
    }
    window.localStorage.removeItem(prefix + turn.id);
  }
  const turns: HubTurn[] = [];
  let next: string | null = null;
  do {
    const response: Response = await fetch(url + (next ? `?after=${encodeURIComponent(next)}` : ""), { credentials: "include", cache: "no-store", signal });
    if (!response.ok) throw new Error("Couldn’t load saved conversations.");
    const page = await response.json() as { turns: HubTurn[]; next: string | null };
    turns.push(...page.turns);
    next = page.next;
  } while (next);
  return { turns, importError };
}
