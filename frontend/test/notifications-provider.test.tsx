import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { NotificationsProvider, useNotifications } from "@/components/providers/notifications-provider";
import type { Notification, RealtimeEvent } from "@/lib/api/contracts";

const manager = {
  subscribe: vi.fn(),
};

let realtimeStatus: "idle" | "connecting" | "connected" | "disconnected" = "connected";
let realtimeListener: ((event: RealtimeEvent) => void) | null = null;

vi.mock("@/components/providers/auth-provider", () => ({
  useAuth: () => ({
    token: "test-token",
    isAuthenticated: true,
  }),
}));

vi.mock("@/components/providers/realtime-provider", () => ({
  useRealtime: () => ({
    status: realtimeStatus,
    manager,
  }),
}));

function notification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: 1,
    kind: "message_new",
    recipient_id: 1,
    conversation_id: 10,
    message_id: 50,
    actor: {
      id: 2,
      username: "alex",
      avatar_url: null,
    },
    data: {
      message_preview: "Hello",
      conversation_title: "alex",
    },
    is_read: false,
    read_at: null,
    created_at: "2026-05-18T10:09:00Z",
    ...overrides,
  };
}

function jsonResponse(body: unknown) {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: async () => body,
  });
}

function Probe() {
  const { notifications, unreadCount, markRead } = useNotifications();
  return (
    <div>
      <p>Unread {unreadCount}</p>
      {notifications.map((item) => (
        <button key={item.id} type="button" onClick={() => void markRead(item.id)}>
          Read {item.id}
        </button>
      ))}
    </div>
  );
}

describe("NotificationsProvider", () => {
  beforeEach(() => {
    realtimeStatus = "connected";
    realtimeListener = null;
    manager.subscribe.mockReset();
    manager.subscribe.mockImplementation((listener: (event: RealtimeEvent) => void) => {
      realtimeListener = listener;
      return () => {
        realtimeListener = null;
      };
    });
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads notifications, applies realtime updates, and marks items as read", async () => {
    const first = notification();
    const realtime = notification({
      id: 2,
      message_id: 51,
      data: {
        message_preview: "Realtime",
        conversation_title: "alex",
      },
    });
    const realtimeRead = notification({
      ...realtime,
      is_read: true,
      read_at: "2026-05-18T10:10:00Z",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (url.endsWith("/notifications?unread_only=false") && method === "GET") {
          return jsonResponse([first]);
        }
        if (url.endsWith("/notifications/2/read") && method === "POST") {
          return jsonResponse(realtimeRead);
        }
        throw new Error(`Unhandled request: ${method} ${url}`);
      }),
    );

    render(
      <NotificationsProvider>
        <Probe />
      </NotificationsProvider>,
    );

    expect(await screen.findByText("Unread 1")).toBeInTheDocument();

    realtimeListener?.({
      type: "notification.created",
      payload: realtime as unknown as Record<string, unknown>,
    });

    expect(await screen.findByText("Unread 2")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Read 2" }));

    await waitFor(() => expect(screen.getByText("Unread 1")).toBeInTheDocument());

    realtimeListener?.({
      type: "notification.read_all",
      payload: {},
    });

    await waitFor(() => expect(screen.getByText("Unread 0")).toBeInTheDocument());
  });
});
