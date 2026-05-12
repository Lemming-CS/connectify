import { getPublicEnv } from "@/lib/api/env";
import type { RealtimeEvent } from "@/lib/api/contracts";

export type RealtimeStatus = "idle" | "connecting" | "connected" | "disconnected";

type Listener = (event: RealtimeEvent) => void;
type StatusListener = (status: RealtimeStatus) => void;

export class RealtimeConnectionManager {
  private socket: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private manuallyClosed = false;
  private token: string | null = null;
  private listeners = new Set<Listener>();
  private statusListeners = new Set<StatusListener>();
  private status: RealtimeStatus = "idle";

  constructor(token?: string | null) {
    this.token = token ?? null;
  }

  connect() {
    if (!this.token || typeof window === "undefined") {
      return;
    }
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const { websocketBaseUrl } = getPublicEnv();
    const url = new URL("/api/v1/realtime/ws", websocketBaseUrl);
    url.searchParams.set("token", this.token);

    this.manuallyClosed = false;
    this.setStatus("connecting");
    this.socket = new WebSocket(url.toString());

    this.socket.addEventListener("open", () => {
      this.setStatus("connected");
    });
    this.socket.addEventListener("message", (event) => {
      try {
        const payload = JSON.parse(String(event.data)) as RealtimeEvent;
        for (const listener of this.listeners) {
          listener(payload);
        }
      } catch {
        // Ignore malformed events from the backend.
      }
    });
    this.socket.addEventListener("close", () => {
      this.socket = null;
      this.setStatus("disconnected");
      if (!this.manuallyClosed && this.token) {
        this.scheduleReconnect();
      }
    });
    this.socket.addEventListener("error", () => {
      this.socket?.close();
    });
  }

  disconnect() {
    this.manuallyClosed = true;
    if (this.reconnectTimer) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.socket?.close();
    this.socket = null;
    this.setStatus("idle");
  }

  updateToken(token: string | null) {
    this.token = token;
    if (!token) {
      this.disconnect();
      return;
    }
    this.disconnect();
    this.connect();
  }

  getStatus() {
    return this.status;
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  subscribeToStatus(listener: StatusListener) {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  private scheduleReconnect() {
    if (this.reconnectTimer || typeof window === "undefined") {
      return;
    }
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 1500);
  }

  private setStatus(status: RealtimeStatus) {
    this.status = status;
    for (const listener of this.statusListeners) {
      listener(status);
    }
  }
}
