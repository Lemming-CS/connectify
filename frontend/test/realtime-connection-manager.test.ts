import { RealtimeConnectionManager } from "@/lib/realtime/connection-manager";

class MockWebSocket {
  static instances: MockWebSocket[] = [];

  url: string;
  readyState = 0;
  private listeners = new Map<string, Set<() => void>>();

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: () => void) {
    const listeners = this.listeners.get(type) || new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  close() {
    this.readyState = 3;
    this.emit("close");
  }

  emit(type: string) {
    for (const listener of this.listeners.get(type) || []) {
      listener();
    }
  }
}

describe("RealtimeConnectionManager", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);
    process.env.NEXT_PUBLIC_API_BASE_URL = "http://localhost:8000/api/v1";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("initializes the websocket with the current token", () => {
    const manager = new RealtimeConnectionManager("token-abc");
    const statuses: string[] = [];

    manager.subscribeToStatus((status) => statuses.push(status));
    manager.connect();

    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0].url).toBe("ws://localhost:8000/api/v1/realtime/ws?token=token-abc");
    expect(statuses).toContain("connecting");

    manager.disconnect();
    expect(statuses.at(-1)).toBe("idle");
  });

  it("reconnects after an unexpected socket close", () => {
    vi.useFakeTimers();
    const manager = new RealtimeConnectionManager("token-abc");

    manager.connect();
    expect(MockWebSocket.instances).toHaveLength(1);

    MockWebSocket.instances[0].emit("close");
    expect(manager.getStatus()).toBe("disconnected");

    vi.advanceTimersByTime(1500);
    expect(MockWebSocket.instances).toHaveLength(2);

    vi.useRealTimers();
  });
});
