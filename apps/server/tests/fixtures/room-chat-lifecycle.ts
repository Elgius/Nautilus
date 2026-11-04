import { RoomChat as BaseRoomChat } from '../../src/room-chat'
import { pauseNextHistory } from './room-chat-db'

// Run against real workerd WebSockets, with database I/O paused at the race boundary.
export class RoomChat extends BaseRoomChat {
  async fetch(request: Request) {
    if (new URL(request.url).pathname !== '/lifecycle-regression') return super.fetch(request)
    const check = (condition: boolean, message: string) => { if (!condition) throw new Error(message) }
    for (const failure of [false, true]) {
      const pair = new WebSocketPair()
      this.ctx.acceptWebSocket(pair[1])
      pair[0].accept()
      pair[1].serializeAttachment({ identity: { organizationId: 'org', roomId: 'room', userId: 'alice', sessionId: 'session' }, window: Date.now(), count: 0 })
      let entered!: () => void, release!: () => void
      const started = new Promise<void>((resolve) => { entered = resolve })
      const blocked = new Promise<void>((resolve) => { release = resolve })
      pauseNextHistory(async () => {
        entered()
        await blocked
        if (failure) throw new Error('Database request failed after disconnect')
      })
      const history = this.webSocketMessage(pair[1], JSON.stringify({ type: 'history' }))
      await started
      const queued = this.webSocketMessage(pair[1], JSON.stringify({ type: 'ping' }))
      pair[1].close(1000, 'Disconnected during query')
      release()
      await Promise.all([history, queued])
      check(pair[1].readyState !== WebSocket.OPEN, 'Disconnected socket must remain closed')
      // Even malformed queued events must not attempt an error response after close.
      await this.webSocketMessage(pair[1], '{')
      this.webSocketError(pair[1])
      await this.webSocketClose(pair[1], 1000)
      pair[0].close()
    }

    // A transport failure can throw even after the OPEN check. Do not retry the
    // error response on the same failed transport; close it once for reconnect.
    let sends = 0, closes = 0
    const failing = {
      readyState: WebSocket.OPEN as number,
      deserializeAttachment: () => ({ identity: { organizationId: 'org', roomId: 'room', userId: 'alice', sessionId: 'session' }, window: Date.now(), count: 0 }),
      serializeAttachment: () => {},
      send: () => { sends++; throw new TypeError("Can't call WebSocket send() after close().") },
      close: () => { closes++; failing.readyState = WebSocket.CLOSING },
    }
    await this.webSocketMessage(failing as unknown as WebSocket, JSON.stringify({ type: 'ping' }))
    check(sends === 1 && closes === 1, 'Transport failures must not trigger another send')
    return new Response('WebSocket disconnect race checks passed')
  }
}
