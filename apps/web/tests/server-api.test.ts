import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { readServerApi, readWorkspaceSession } from "../lib/server-api";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
function respond(response: () => Promise<Response>) {
  globalThis.fetch = response as typeof fetch;
}

test("connection refusal, timeout and interrupted reads become retryable state", async () => {
  for (const error of [new TypeError("fetch failed"), new DOMException("Timed out", "TimeoutError"), new DOMException("Aborted", "AbortError")]) {
    respond(async () => { throw error; });
    assert.deepEqual(await readServerApi("/api/me", "session=kept"), { status: "unavailable" });
  }
  respond(async () => new Response(new ReadableStream({
    start(controller) { controller.error(new TypeError("terminated")); },
  })));
  assert.deepEqual(await readServerApi("/api/me", "session=kept"), { status: "unavailable" });
});

test("gateway outages become retryable while authentication and missing resources stay distinct", async () => {
  for (const code of [502, 503, 504]) {
    respond(async () => new Response(null, { status: code }));
    assert.deepEqual(await readServerApi("/api/rooms/test", "session=kept"), { status: "unavailable" });
  }
  for (const code of [401, 403, 404, 500]) {
    respond(async () => new Response(null, { status: code }));
    assert.deepEqual(await readServerApi("/api/rooms/test", "session=kept"), { status: "http-error", code });
  }
});

test("session retries preserve credentials and re-fetch after the API recovers", async () => {
  const calls: { cookie: string | null; cache: RequestCache | undefined }[] = [];
  let available = false;
  const session = { user: { id: "user" }, activeOrganization: { id: "org" } };
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    calls.push({ cookie: new Headers(init?.headers).get("cookie"), cache: init?.cache });
    if (!available) throw new TypeError("fetch failed");
    return Response.json(session);
  }) as typeof fetch;
  assert.deepEqual(await readWorkspaceSession("session=kept"), { status: "unavailable" });
  available = true;
  assert.deepEqual(await readWorkspaceSession("session=kept"), { status: "ok", data: session });
  assert.deepEqual(calls, Array.from({ length: 2 }, () => ({ cookie: "session=kept", cache: "no-store" })));
});

test("an API outage does not look like logout, but missing and expired sessions do", async () => {
  let calls = 0;
  respond(async () => { calls++; return new Response(null, { status: 503 }); });
  assert.deepEqual(await readWorkspaceSession(null), { status: "ok", data: null });
  assert.equal(calls, 0);
  assert.deepEqual(await readWorkspaceSession("session=kept"), { status: "unavailable" });
  respond(async () => new Response(null, { status: 401 }));
  assert.deepEqual(await readWorkspaceSession("session=expired"), { status: "ok", data: null });
});

test("unexpected errors and malformed data remain errors rather than connection outages", async () => {
  respond(async () => { throw new Error("Unexpected failure"); });
  await assert.rejects(readServerApi("/api/me", "session=kept"), /Unexpected failure/);
  respond(async () => new Response("not json"));
  await assert.rejects(readServerApi("/api/me", "session=kept"), SyntaxError);
  respond(async () => new Response(null, { status: 500 }));
  await assert.rejects(readWorkspaceSession("session=kept"), /Unable to load your session/);
});
