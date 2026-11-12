import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { Miniflare } from 'miniflare'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('..', import.meta.url))
const bundle = await build({
  stdin: { contents: `import app from './src/index'; import { RoomChat } from './tests/fixtures/room-chat-lifecycle'; import { revoke, seed, schedulerExecutions } from './tests/fixtures/room-chat-db'; import { privateAgentCalls } from './tests/fixtures/private-agent-stream'; export { RoomChat }; export default { fetch(request, env, ctx) { const url = new URL(request.url); if (url.pathname === '/scheduler-results') return Response.json(schedulerExecutions()); if (url.pathname === '/agent-calls') return Response.json({ calls: privateAgentCalls() }); if (url.pathname === '/seed') { seed(); return new Response('ok'); } if (url.pathname === '/revoke') { revoke(); return new Response('ok'); } const room = url.searchParams.get('room') || 'room'; if (url.pathname === '/socket') { url.pathname = '/api/room-sockets/org/' + room; return app.fetch(new Request(url, request), env, ctx); } return env.ROOM_CHAT.get(env.ROOM_CHAT.idFromName(JSON.stringify(['org', room]))).fetch(request); } };`, resolveDir: root, loader: 'ts' },
  bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', external: ['cloudflare:workers', 'node:*'],
  plugins: [{ name: 'test-database', setup(builder) { builder.onResolve({ filter: /^\.\/private-room-agent-stream$/ }, () => ({ path: path.join(root, 'tests/fixtures/private-agent-stream.ts') })); builder.onResolve({ filter: /^\.{1,2}\/db$/ }, () => ({ path: path.join(root, 'tests/fixtures/room-chat-db.ts') })) } }],
})
const mf = new Miniflare({ workers: [{ config: {
  name: 'room-test', compatibilityDate: '2026-10-24', compatibilityFlags: ['nodejs_compat'],
  manifest: { mainModule: 'index.js', modules: { 'index.js': { type: 'esm', contents: bundle.outputFiles[0].text } } },
  exports: { RoomChat: { type: 'durable-object', storage: 'sqlite' } },
  env: { ROOM_CHAT: { type: 'durable-object', worker: 'room-test', exportName: 'RoomChat' }, WEB_ORIGIN: { type: 'text', value: 'https://web.test' }, DATABASE_URL: { type: 'text', value: 'test' } },
} }] })
const sockets = []
const queues = new WeakMap()
async function ticket(userId, room = 'room', organizationId = 'org') {
  const response = await mf.dispatchFetch(`https://api.test/ticket?room=${room}`, { method: 'POST', body: JSON.stringify({ userId, roomId: room, organizationId, sessionId: 'session', name: userId }) })
  return (await response.json()).ticket
}
async function upgrade(token, room = 'room', origin = 'https://web.test') {
  return mf.dispatchFetch(`https://api.test/socket?room=${room}&ticket=${token}`, { headers: { Upgrade: 'websocket', Origin: origin } })
}
async function connect(userId, room = 'room') {
  const response = await upgrade(await ticket(userId, room), room)
  assert.equal(response.status, 101)
  const socket = response.webSocket
  const queue = []; queues.set(socket, queue)
  socket.addEventListener('message', ({ data }) => queue.push(JSON.parse(data)))
  socket.accept(); sockets.push(socket)
  await receive(socket, 'ready')
  return socket
}
async function receive(socket, type) {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    const queue = queues.get(socket)
    const index = queue.findIndex((event) => event.type === type)
    if (index >= 0) return queue.splice(index, 1)[0]
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`Timed out waiting for ${type}`)
}
const send = (socket, event) => socket.send(JSON.stringify(event))
try {
  const lifecycle = await mf.dispatchFetch('https://api.test/lifecycle-regression')
  assert.equal(lifecycle.status, 200, await lifecycle.text())
  // A passive reader's automatic receipts cannot exhaust their send allowance.
  const busySender = await connect('alice', 'busy-room'), busyReader = await connect('bob', 'busy-room')
  for (let index = 0; index < 40; index++) {
    const id = crypto.randomUUID()
    send(busySender, { type: 'send', requestId: id, clientMessageId: id, text: `Burst ${index}` })
    await receive(busySender, 'ack')
    await receive(busyReader, 'message')
    send(busyReader, { type: 'read' })
    await receive(busyReader, 'read')
  }
  const replyId = crypto.randomUUID()
  send(busyReader, { type: 'send', requestId: replyId, clientMessageId: replyId, text: 'My first message' })
  assert.equal((await receive(busyReader, 'ack')).requestId, replyId)
  // Both allowances remain bounded independently.
  send(busyReader, { type: 'read', requestId: 'receipt-limit' })
  assert.equal((await receive(busyReader, 'error')).requestId, 'receipt-limit')
  const overflowId = crypto.randomUUID()
  send(busySender, { type: 'send', requestId: overflowId, clientMessageId: overflowId, text: 'Over the send limit' })
  assert.equal((await receive(busySender, 'error')).requestId, overflowId)
  assert.equal((await upgrade(await ticket('alice'), 'room', 'https://evil.test')).status, 403)
  assert.equal((await upgrade(await ticket('outsider'))).status, 403)
  assert.equal((await upgrade(await ticket('expired'))).status, 403)
  assert.equal((await upgrade(await ticket('alice', 'room', 'wrong-org'))).status, 403)
  const oneUse = await ticket('alice')
  const first = await upgrade(oneUse); assert.equal(first.status, 101); first.webSocket.accept(); sockets.push(first.webSocket)
  assert.equal((await upgrade(oneUse)).status, 401)
  const alice = await connect('alice'), bob = await connect('bob'), other = await connect('carol', 'other')
  const id = crypto.randomUUID()
  send(alice, { type: 'send', clientMessageId: id, requestId: id, text: 'Hello Bob', authorUserId: 'mallory', authorAgentId: 'bot' })
  const delivered = await receive(bob, 'message')
  assert.equal(delivered.message.text, 'Hello Bob'); assert.equal(delivered.message.authorUserId, 'alice')
  const ack = await receive(alice, 'ack'); assert.equal(ack.message.id, delivered.message.id)
  send(alice, { type: 'send', clientMessageId: id, requestId: id, text: 'duplicate' })
  assert.equal((await receive(alice, 'ack')).message.id, delivered.message.id)
  send(bob, { type: 'sync' }); assert.equal((await receive(bob, 'sync')).messages.length, 1)
  send(other, { type: 'sync' }); assert.equal((await receive(other, 'sync')).messages.length, 0)
  assert.equal(queues.get(other).some((event) => event.type === 'message'), false)
  send(bob, { type: 'sync', cursor: delivered.message.id }); assert.equal((await receive(bob, 'sync')).messages.length, 0)
  // Resume an offline cursor across more than two complete replay pages.
  await mf.dispatchFetch('https://api.test/seed')
  let cursor = delivered.message.id
  const replay = []
  do {
    send(bob, { type: 'sync', cursor })
    const page = await receive(bob, 'sync')
    replay.push(...page.messages.map((message) => message.id))
    cursor = page.nextCursor
  } while (cursor)
  assert.equal(replay.length, 205); assert.equal(new Set(replay).size, 205)
  assert.equal(replay[0], 'seed-0'); assert.equal(replay.at(-1), 'seed-204')
  send(other, { type: 'history', cursor: delivered.message.id })
  assert.match((await receive(other, 'error')).error, /Invalid history cursor/)
  send(bob, { type: 'typing' }); assert.equal((await receive(alice, 'typing')).userId, 'bob')
  send(bob, { type: 'read' }); assert.equal((await receive(alice, 'read')).userId, 'bob')
  const presence = await receive(bob, 'presence'); assert.equal(presence.users.filter((user) => user.id === 'alice').length, 1)
  const aliceTab = await connect('alice')
  send(alice, { type: 'agent.list' })
  assert.equal((await receive(alice, 'agent.list')).agents[0].id, 'agent-1')
  send(other, { type: 'agent.list' })
  assert.equal((await receive(other, 'agent.list')).agents.length, 0)
  const privateId = crypto.randomUUID(), secret = 'ALICE_PRIVATE_INSTRUCTION_8381'
  send(alice, { type: 'agent.invoke', requestId: privateId, agentId: 'agent-1', instruction: secret, userId: 'bob' })
  // The public room queue must remain responsive while the model is streaming.
  const publicId = crypto.randomUUID()
  send(alice, { type: 'send', clientMessageId: publicId, requestId: publicId, text: 'Public while agent runs' })
  assert.equal((await receive(alice, 'ack')).message.text, 'Public while agent runs')
  assert.equal(queues.get(alice).some((event) => event.type === 'agent.update' && event.job.status === 'complete'), false)
  const draft = await receive(alice, 'agent.document-preview')
  assert.equal(draft.runId, privateId)
  assert.match(draft.input, /Partial ALICE_PRIVATE_INSTRUCTION_8381/)
  assert.equal(queues.get(alice).some((event) => event.type === 'agent.update' && event.job.status === 'complete'), false, 'queued previews arrive over the real socket before completion')
  let privateResult
  do { privateResult = await receive(alice, 'agent.update') } while (privateResult.job.status !== 'complete')
  assert.equal(privateResult.job.instruction, secret)
  assert.equal(privateResult.job.reply, 'Private reply: ' + secret)
  let tabResult
  do { tabResult = await receive(aliceTab, 'agent.update') } while (tabResult.job.status !== 'complete')
  assert.equal(tabResult.job.id, privateId)
  for (const peer of [bob, other]) {
    assert.equal(queues.get(peer).some((event) => event.type.startsWith('agent.') && JSON.stringify(event).includes(secret)), false)
  }
  send(bob, { type: 'agent.history', userId: 'alice' })
  assert.deepEqual((await receive(bob, 'agent.history')).jobs, [])
  send(aliceTab, { type: 'agent.history' })
  assert.equal((await receive(aliceTab, 'agent.history')).jobs[0].instruction, secret)
  send(alice, { type: 'agent.invoke', requestId: privateId, agentId: 'agent-1', instruction: secret })
  assert.equal((await receive(alice, 'agent.update')).job.id, privateId)
  assert.equal((await (await mf.dispatchFetch('https://api.test/agent-calls')).json()).calls, 1)
  send(other, { type: 'agent.invoke', requestId: crypto.randomUUID(), agentId: 'agent-1', instruction: 'not assigned' })
  assert.match((await receive(other, 'error')).error, /Invalid agent selection/)
  send(bob, { type: 'agent.invoke', requestId: privateId, agentId: 'agent-1', instruction: 'BOB_PRIVATE_INSTRUCTION' })
  let bobResult
  do { bobResult = await receive(bob, 'agent.update') } while (bobResult.job.status !== 'complete')
  assert.equal(bobResult.job.instruction, 'BOB_PRIVATE_INSTRUCTION')
  send(alice, { type: 'agent.history', userId: 'bob' })
  assert.equal((await receive(alice, 'agent.history')).jobs.some((job) => job.instruction.includes('BOB_PRIVATE')), false)
  send(alice, { type: 'history' })
  const publicHistory = await receive(alice, 'history')
  assert.equal(JSON.stringify(publicHistory).includes(secret), false)
  assert.equal(JSON.stringify(publicHistory).includes('BOB_PRIVATE'), false)
  send(alice, { type: 'send', clientMessageId: crypto.randomUUID(), text: '@Scout ' + secret })
  assert.match((await receive(alice, 'error')).error, /Select an agent/)
  // Scheduler delivery uses real Durable Object storage and owner-only delivery.
  const scheduledId = 'c326b5dc-0fdd-4d70-b838-d155fe1ecacd'
  const deliver = (leaseToken = 'valid-lease', room = 'room', deliveryId = scheduledId) => mf.dispatchFetch(`https://api.test/scheduler?room=${room}`, { method: 'POST', body: JSON.stringify({ deliveryId, leaseToken }) })
  assert.equal((await deliver('expired-lease')).status, 409)
  assert.equal((await deliver('valid-lease', 'other')).status, 403)
  assert.equal((await deliver('valid-lease', 'room', 'c326b5dc-0fdd-4d70-b838-d155fe1ecace')).status, 403)
  assert.equal((await deliver()).status, 202)
  let scheduledResult
  do { scheduledResult = await receive(alice, 'agent.update') } while (scheduledResult.job.id !== scheduledId || scheduledResult.job.status !== 'complete')
  assert.match(scheduledResult.job.reply, /SCHEDULED_PRIVATE_TASK/)
  const persistedExecution = (await (await mf.dispatchFetch('https://api.test/scheduler-results')).json())[scheduledId]
  assert.equal(persistedExecution.executionState, 'complete')
  assert.match(persistedExecution.result, /SCHEDULED_PRIVATE_TASK/)
  const callsBeforeRetry = (await (await mf.dispatchFetch('https://api.test/agent-calls')).json()).calls
  assert.equal((await deliver()).status, 202)
  assert.equal((await (await mf.dispatchFetch('https://api.test/agent-calls')).json()).calls, callsBeforeRetry)
  for (const peer of [bob, other]) assert.equal(queues.get(peer).some((event) => JSON.stringify(event).includes('SCHEDULED_PRIVATE_TASK')), false)
  // Cancel through a browser socket while a different job holds the room queue.
  const blockerId = crypto.randomUUID(), cancelledId = 'c326b5dc-0fdd-4d70-b838-d155fe1ecacf'
  send(alice, { type: 'agent.invoke', requestId: blockerId, agentId: 'agent-1', instruction: 'Blocking work' })
  let blocker
  do { blocker = await receive(alice, 'agent.update') } while (blocker.job.id !== blockerId || blocker.job.status !== 'running')
  assert.equal((await deliver('valid-lease', 'room', cancelledId)).status, 202)
  let cancelled
  do { cancelled = await receive(alice, 'agent.update') } while (cancelled.job.id !== cancelledId)
  assert.equal(cancelled.job.status, 'queued')
  send(alice, { type: 'agent.cancel', jobId: cancelledId })
  do { cancelled = await receive(alice, 'agent.update') } while (cancelled.job.id !== cancelledId || cancelled.job.status !== 'failed')
  const readExecution = async () => (await (await mf.dispatchFetch('https://api.test/scheduler-results')).json())[cancelledId]
  assert.deepEqual(await readExecution(), { executionState: 'failed', result: '', executionError: 'Cancelled before starting.' })
  const refreshed = await connect('alice')
  send(refreshed, { type: 'agent.history' })
  assert.equal((await receive(refreshed, 'agent.history')).jobs.find((job) => job.id === cancelledId).status, 'failed')
  assert.equal((await readExecution()).executionState, 'failed')
  await mf.dispatchFetch('https://api.test/revoke')
  const closed = new Promise((resolve) => bob.addEventListener('close', (event) => resolve(event.code), { once: true }))
  send(bob, { type: 'send', clientMessageId: crypto.randomUUID(), text: 'revoked' })
  assert.equal(await Promise.race([closed, new Promise((_, reject) => setTimeout(() => reject(new Error('Revocation did not close socket')), 5000))]), 4003)
  console.log('Room WebSocket runtime checks passed (including private agent isolation, same-user tabs, deduplicated invocations, and nonblocking public chat): delivery, deduplication, history, room isolation, origin, tickets, membership, revocation, typing, presence, read receipts.')
} finally {
  for (const socket of sockets) socket.close()
  await mf.dispose()
}
