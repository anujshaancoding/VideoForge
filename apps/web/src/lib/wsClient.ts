// WebSocket client — connects to the API's /ws endpoint and dispatches
// asset:ready and export:progress events to registered handlers.
//
// Auth (Wave 2): the hub now authenticates the socket with the access JWT as a
// `?token=` query param (the old `?workspaceId=` is gone). We read the token from
// lib/api.ts memory at connect time so a token rotated by a refresh is picked up on
// the next (re)connect.

import { getAccessToken } from './api.js';

const WS_URL = (import.meta.env.VITE_WS_URL as string | undefined) ?? 'ws://localhost:4000/ws';

type Handler = (payload: Record<string, unknown>) => void;

class WsClient {
  private ws: WebSocket | null = null;
  private handlers: Map<string, Set<Handler>> = new Map();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private shouldConnect = false;

  connect(): void {
    this.shouldConnect = true;
    this._connect();
  }

  private _connect(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
    try {
      const token = getAccessToken();
      const qs = token ? `?token=${encodeURIComponent(token)}` : '';
      this.ws = new WebSocket(`${WS_URL}${qs}`);
      this.ws.addEventListener('message', (e) => {
        try {
          const payload = JSON.parse(e.data as string) as Record<string, unknown>;
          const type = payload['type'] as string | undefined;
          if (type) this.dispatch(type, payload);
        } catch {}
      });
      this.ws.addEventListener('close', () => {
        if (this.shouldConnect) {
          this.reconnectTimer = setTimeout(() => this._connect(), 3000);
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
