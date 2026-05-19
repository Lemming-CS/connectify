import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { MessengerWorkspace } from "@/features/messenger/messenger-workspace";
import type { Chat, Message, RealtimeEvent, Topic, User } from "@/lib/api/contracts";

const currentUser: User = {
  id: 1,
  email: "owner@example.com",
  username: "owner",
  avatar_url: null,
  description: null,
  status: "online",
  is_active: true,
  created_at: "2026-05-18T10:00:00Z",
  updated_at: "2026-05-18T10:00:00Z",
};

const manager = {
  subscribe: vi.fn(),
};

let realtimeStatus: "idle" | "connecting" | "connected" | "disconnected" = "connected";
let realtimeListener: ((event: RealtimeEvent) => void) | null = null;

vi.mock("@/components/providers/auth-provider", () => ({
  useAuth: () => ({
    token: "test-token",
    user: currentUser,
  }),
}));

vi.mock("@/components/providers/realtime-provider", () => ({
  useRealtime: () => ({
    status: realtimeStatus,
    manager,
    lastEvent: null,
  }),
}));

function chat(overrides: Partial<Chat> = {}): Chat {
  return {
    id: 10,
    kind: "direct",
    title: null,
    description: null,
    avatar_url: null,
    created_at: "2026-05-18T10:00:00Z",
    updated_at: "2026-05-18T10:00:00Z",
    last_message_at: "2026-05-18T10:05:00Z",
    members: [
      { id: 1, username: "owner", avatar_url: null, status: "online", role: "owner" },
      { id: 2, username: "alex", avatar_url: null, status: "away", role: "member" },
    ],
    read_states: [
      { user_id: 1, username: "owner", last_read_message_id: 1, last_read_at: "2026-05-18T10:05:00Z" },
      { user_id: 2, username: "alex", last_read_message_id: 1, last_read_at: "2026-05-18T10:05:00Z" },
    ],
    ...overrides,
  };
}

function message(overrides: Partial<Message> = {}): Message {
  return {
    id: 1,
    conversation_id: 10,
    topic_id: null,
    sender: {
      id: 2,
      username: "alex",
      avatar_url: null,
    },
    body: "Initial message",
    attachments: [],
    created_at: "2026-05-18T10:05:00Z",
    edited_at: null,
    deleted_at: null,
    ...overrides,
  };
}

function topic(overrides: Partial<Topic> = {}): Topic {
  return {
    id: 201,
    conversation_id: 20,
    title: "General",
    description: "General topic",
    is_general: true,
    is_closed: false,
    archived_at: null,
    created_at: "2026-05-18T10:00:00Z",
    updated_at: "2026-05-18T10:00:00Z",
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

describe("MessengerWorkspace", () => {
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

  it("renders message history for the selected chat", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/chats")) {
          return jsonResponse([chat()]);
        }
        if (url.endsWith("/chats/10/messages?limit=30") || url.endsWith("/chats/10/messages")) {
          return jsonResponse({
            items: [message()],
            next_before_id: null,
          });
        }
        if (url.endsWith("/chats/10/read")) {
          return jsonResponse({
            user_id: 1,
            username: "owner",
            last_read_message_id: 1,
            last_read_at: "2026-05-18T10:06:00Z",
          });
        }
        throw new Error(`Unhandled request: ${url}`);
      }),
    );

    render(<MessengerWorkspace />);

    expect(await screen.findByText("Initial message")).toBeInTheDocument();
    expect(screen.getAllByText("alex").length).toBeGreaterThan(0);
  });

  it("sends a new message and appends it once", async () => {
    const sentMessage = message({
      id: 2,
      sender: {
        id: 1,
        username: "owner",
        avatar_url: null,
      },
      body: "Shipped",
      created_at: "2026-05-18T10:06:00Z",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (url.endsWith("/chats") && method === "GET") {
          return jsonResponse([chat()]);
        }
        if (url.endsWith("/chats/10/messages?limit=30") && method === "GET") {
          return jsonResponse({
            items: [message()],
            next_before_id: null,
          });
        }
        if (url.endsWith("/chats/10/read")) {
          return jsonResponse({
            user_id: 1,
            username: "owner",
            last_read_message_id: 1,
            last_read_at: "2026-05-18T10:06:00Z",
          });
        }
        if (url.endsWith("/chats/10/typing")) {
          return jsonResponse({ accepted: true });
        }
        if (url.endsWith("/chats/10/messages") && method === "POST") {
          return jsonResponse(sentMessage);
        }
        throw new Error(`Unhandled request: ${method} ${url}`);
      }),
    );

    render(<MessengerWorkspace />);

    await screen.findByText("Initial message");
    fireEvent.change(screen.getByLabelText("Message body"), { target: { value: "Shipped" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("Shipped")).toBeInTheDocument();
    expect(screen.getAllByText("Shipped")).toHaveLength(1);
  });

  it("applies realtime message events without duplicating them", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/chats")) {
          return jsonResponse([chat()]);
        }
        if (url.endsWith("/chats/10/messages?limit=30")) {
          return jsonResponse({
            items: [message()],
            next_before_id: null,
          });
        }
        if (url.endsWith("/chats/10/read")) {
          return jsonResponse({
            user_id: 1,
            username: "owner",
            last_read_message_id: 1,
            last_read_at: "2026-05-18T10:06:00Z",
          });
        }
        throw new Error(`Unhandled request: ${url}`);
      }),
    );

    render(<MessengerWorkspace />);
    await screen.findByText("Initial message");

    const event: RealtimeEvent = {
      type: "message.created",
      conversation_id: 10,
      payload: message({
        id: 3,
        body: "Realtime hello",
        created_at: "2026-05-18T10:07:00Z",
      }) as unknown as Record<string, unknown>,
    };

    realtimeListener?.(event);
    realtimeListener?.(event);

    await waitFor(() => expect(screen.getByText("Realtime hello")).toBeInTheDocument());
    expect(screen.getAllByText("Realtime hello")).toHaveLength(1);
  });

  it("creates a supergroup and shows it in the list", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (url.endsWith("/chats") && method === "GET") {
          return jsonResponse([]);
        }
        if (url.endsWith("/chats/supergroup") && method === "POST") {
          return jsonResponse(
            chat({
              id: 20,
              kind: "supergroup",
              title: "Platform",
              description: "Roadmap",
              members: [
                { id: 1, username: "owner", avatar_url: null, status: "online", role: "owner" },
                { id: 2, username: "alex", avatar_url: null, status: "away", role: "member" },
              ],
            }),
          );
        }
        if (url.endsWith("/chats/20/topics") && method === "GET") {
          return jsonResponse([topic()]);
        }
        if (url.endsWith("/chats/20/topics/201/messages?limit=30") && method === "GET") {
          return jsonResponse({ items: [], next_before_id: null });
        }
        throw new Error(`Unhandled request: ${method} ${url}`);
      }),
    );

    render(<MessengerWorkspace />);

    fireEvent.change(screen.getByLabelText("Group title"), { target: { value: "Platform" } });
    fireEvent.change(screen.getByLabelText("Group description"), { target: { value: "Roadmap" } });
    fireEvent.change(screen.getByLabelText("Group member IDs"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Group kind"), { target: { value: "supergroup" } });
    fireEvent.click(screen.getByRole("button", { name: "Create supergroup" }));

    await waitFor(() => expect(screen.getAllByText("Platform").length).toBeGreaterThan(0));
    expect(screen.getAllByText(/supergroup/i).length).toBeGreaterThan(0);
  });

  it("switches between supergroup topics and isolates messages", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/chats")) {
          return jsonResponse([
            chat({
              id: 20,
              kind: "supergroup",
              title: "Platform",
              description: "Roadmap",
            }),
          ]);
        }
        if (url.endsWith("/chats/20/topics")) {
          return jsonResponse([
            topic(),
            topic({
              id: 202,
              title: "Releases",
              description: "Release train",
              is_general: false,
            }),
          ]);
        }
        if (url.endsWith("/chats/20/topics/201/messages?limit=30")) {
          return jsonResponse({
            items: [
              message({
                id: 11,
                conversation_id: 20,
                topic_id: 201,
                body: "General thread",
              }),
            ],
            next_before_id: null,
          });
        }
        if (url.endsWith("/chats/20/topics/202/messages?limit=30")) {
          return jsonResponse({
            items: [
              message({
                id: 12,
                conversation_id: 20,
                topic_id: 202,
                body: "Release thread",
              }),
            ],
            next_before_id: null,
          });
        }
        if (url.endsWith("/chats/20/read")) {
          return jsonResponse({
            user_id: 1,
            username: "owner",
            last_read_message_id: 12,
            last_read_at: "2026-05-18T10:06:00Z",
          });
        }
        throw new Error(`Unhandled request: ${url}`);
      }),
    );

    render(<MessengerWorkspace />);

    expect(await screen.findByText("General thread")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Releases/i }));
    expect(await screen.findByText("Release thread")).toBeInTheDocument();
    expect(screen.queryByText("General thread")).not.toBeInTheDocument();
  });

  it("hides moderator controls for non-admin members", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/chats")) {
          return jsonResponse([
            chat({
              id: 20,
              kind: "supergroup",
              title: "Platform",
              members: [
                { id: 1, username: "owner", avatar_url: null, status: "online", role: "member" },
                { id: 2, username: "alex", avatar_url: null, status: "away", role: "member" },
              ],
            }),
          ]);
        }
        if (url.endsWith("/chats/20/topics")) {
          return jsonResponse([topic()]);
        }
        if (url.endsWith("/chats/20/topics/201/messages?limit=30")) {
          return jsonResponse({ items: [], next_before_id: null });
        }
        throw new Error(`Unhandled request: ${url}`);
      }),
    );

    render(<MessengerWorkspace />);

    await waitFor(() => expect(screen.getAllByText("Platform").length).toBeGreaterThan(0));
    expect(screen.queryByText("Add member")).not.toBeInTheDocument();
    expect(screen.queryByText("Create topic")).not.toBeInTheDocument();
  });
});
