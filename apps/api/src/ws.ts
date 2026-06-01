// ─────────────────────────────────────────────────────────────────────────────
// WebSocket hub — in-process pub/sub keyed by workspaceId.
// Broadcasts asset:ready and export:* events to all connected clients in a
// workspace room.
// ─────────────────────────────────────────────────────────────────────────────

/** Minimal interface covering only the operations we need from a WebSocket. */
interface WsSocket {
  send(data: string): void;
  on(event: 'close', listener: () => void): this;
}

/** Map workspaceId → live connections. */
const rooms = new Map<string, Set<WsSocket>>();

/**
 * Register a new WebSocket connection into its workspace room.
 * The socket is automatically removed when it closes.
 */
export function registerWs(ws: WsSocket, workspaceId: string): void {
  if (!rooms.has(workspaceId)) {
    rooms.set(workspaceId, new Set());
  }
  rooms.get(workspaceId)!.add(ws);
  ws.on('close', () => {
    rooms.get(workspaceId)?.delete(ws);
  });
}

/**
 * Broadcast a JSON payload to every connection in a workspace.
 * Silently ignores sockets that have already closed.
 */
export function broadcast(workspaceId: string, payload: unknown): void {
  const msg = JSON.stringify(payload);
  rooms.get(workspaceId)?.forEach((ws) => {
    try {
      ws.send(msg);
    } catch {
      // Socket closed between iteration start and send — safe to ignore.
    }
  });
}
