// WebSocket client — connects to the API's /ws endpoint and dispatches
// asset:ready and export:progress events to registered handlers.

const WS_URL = (import.meta.env.VITE_WS_URL as string | undefined) ?? 'ws://localhost:4000/ws';

type Handler = (payload: Record<string, unknown>) => void;

class WsClient {
  private ws: WebSocket | null = null;
  private handlers: Map<string, Set<Handler>> = new Map();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private shouldConnect = false;

  connect(workspaceId = 'dev-workspace'): void {
    this.shouldConnect = true;
    this._connect(workspaceId);
  }

  private _connect(workspaceId: string): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
    try {
      this.ws = new WebSocket(`${WS_URL}?workspaceId=${encodeURIComponent(workspaceId)}`);
      this.ws.addEventListener('message', (e) => {
        try {
          const payload = JSON.parse(e.data as string) as Record<string, unknown>;
          const type = payload['type'] as string | undefined;
          if (type) this.dispatch(type, payload);
        } catch {}
      });
      this.ws.addEventListener('close', () => {
        if (this.shouldConnect) {
          this.reconnectTimer = setTimeout(() => this._connect(workspaceId), 3000);
        }
      });
      this.ws.addEventListener('error', () => {
        this.ws?.close();
      });
    } catch {
      // WebSocket not available or URL invalid — silent in tests
    }
  }

  disconnect(): void {
    this.shouldConnect = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
  }

  on(type: string, handler: Handler): () => void {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(handler);
    return () => this.handlers.get(type)?.delete(handler);
  }

  private dispatch(type: string, payload: Record<string, unknown>): void {
    this.handlers.get(type)?.forEach((h) => {
      try { h(payload); } catch {}
    });
  }
}

export const wsClient = new WsClient();
