import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { MessengerWorkspace } from "@/features/messenger/messenger-workspace";
import type { Call, Chat, Message, RealtimeEvent, Topic, User } from "@/lib/api/contracts";

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
let realtimeListeners = new Set<(event: RealtimeEvent) => void>();
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

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

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
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

function call(overrides: Partial<Call> = {}): Call {
  return {
    id: 700,
    conversation_id: 10,
    caller: {
      id: 1,
      username: "owner",
      avatar_url: null,
    },
    callee: {
      id: 2,
      username: "alex",
      avatar_url: null,
    },
    ended_by_id: null,
    kind: "audio",
    status: "ringing",
    metadata: {},
    created_at: "2026-05-18T10:08:00Z",
    accepted_at: null,
    ended_at: null,
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

function blobResponse(body: Blob, ok = true) {
  return Promise.resolve({
    ok,
    status: ok ? 200 : 403,
    statusText: ok ? "OK" : "Forbidden",
    blob: async () => body,
  });
}

function emitRealtime(event: RealtimeEvent) {
  for (const listener of realtimeListeners) {
    listener(event);
  }
}

class MockUploadTarget {
  private listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();

  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    const listeners = this.listeners.get(type) || new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  emit(type: string, event: Event) {
    for (const listener of this.listeners.get(type) || []) {
      if (typeof listener === "function") {
        listener(event);
      } else {
        listener.handleEvent(event);
      }
    }
  }
}

class MockXMLHttpRequest {
  static instances: MockXMLHttpRequest[] = [];
  static responseBody: unknown = {};

  upload = new MockUploadTarget();
  status = 201;
  statusText = "Created";
  responseText = "";
  open = vi.fn();
  setRequestHeader = vi.fn();
  private listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();

  constructor() {
    MockXMLHttpRequest.instances.push(this);
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    const listeners = this.listeners.get(type) || new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  send() {
    queueMicrotask(() => {
      this.responseText = JSON.stringify(MockXMLHttpRequest.responseBody);
      this.upload.emit(
        "progress",
        Object.assign(new Event("progress"), {
          lengthComputable: true,
          loaded: 5,
          total: 10,
        }) as ProgressEvent,
      );
      this.emit("load", new Event("load"));
    });
  }

  private emit(type: string, event: Event) {
    for (const listener of this.listeners.get(type) || []) {
      if (typeof listener === "function") {
        listener(event);
      } else {
        listener.handleEvent(event);
      }
    }
  }
}

class MockMediaStream {
  private tracks: Array<MediaStreamTrack & { kind: string }> = [];

  constructor(tracks: Array<MediaStreamTrack & { kind: string }> = []) {
    this.tracks = tracks;
  }

  addTrack(track: MediaStreamTrack & { kind: string }) {
    this.tracks.push(track);
  }

  getTracks() {
    return this.tracks;
  }

  getAudioTracks() {
    return this.tracks.filter((track) => track.kind === "audio");
  }

  getVideoTracks() {
    return this.tracks.filter((track) => track.kind === "video");
  }
}

class MockPeerConnection {
  addTrack = vi.fn();
  addEventListener = vi.fn();
  close = vi.fn();
  createOffer = vi.fn(async () => ({ type: "offer", sdp: "offer-sdp" }) as RTCSessionDescriptionInit);
  createAnswer = vi.fn(async () => ({ type: "answer", sdp: "answer-sdp" }) as RTCSessionDescriptionInit);
  setLocalDescription = vi.fn();
  setRemoteDescription = vi.fn();
  addIceCandidate = vi.fn();
}

describe("MessengerWorkspace", () => {
  beforeEach(() => {
    realtimeStatus = "connected";
    realtimeListeners = new Set();
    manager.subscribe.mockReset();
    manager.subscribe.mockImplementation((listener: (event: RealtimeEvent) => void) => {
      realtimeListeners.add(listener);
      return () => {
        realtimeListeners.delete(listener);
      };
    });
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: originalCreateObjectURL,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: originalRevokeObjectURL,
    });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: undefined,
    });
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

    emitRealtime(event);
    emitRealtime(event);

    await waitFor(() => expect(screen.getByText("Realtime hello")).toBeInTheDocument());
    expect(screen.getAllByText("Realtime hello")).toHaveLength(1);
  });

  it("uploads an attachment, renders it, and opens an authenticated image preview", async () => {
    const uploadedMessage = message({
      id: 50,
      sender: {
        id: 1,
        username: "owner",
        avatar_url: null,
      },
      body: "Photo notes",
      attachments: [
        {
          id: 900,
          kind: "image",
          is_voice_message: false,
          original_filename: "diagram.png",
          content_type: "image/png",
          size_bytes: 2048,
          checksum_sha256: null,
          width: 640,
          height: 480,
          duration_seconds: null,
          created_at: "2026-05-18T10:09:00Z",
          media_url: "/api/v1/media/attachments/900",
        },
      ],
      created_at: "2026-05-18T10:09:00Z",
    });
    MockXMLHttpRequest.instances = [];
    MockXMLHttpRequest.responseBody = uploadedMessage;
    const createObjectURL = vi.fn(() => "blob:preview");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("XMLHttpRequest", MockXMLHttpRequest as unknown as typeof XMLHttpRequest);
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectURL,
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
          return jsonResponse({ items: [], next_before_id: null });
        }
        if (url.endsWith("/chats/10/typing")) {
          return jsonResponse({ accepted: true });
        }
        if (url.endsWith("/media/attachments/900")) {
          expect(init?.headers).toEqual({ Authorization: "Bearer test-token" });
          return blobResponse(new Blob(["image"], { type: "image/png" }));
        }
        throw new Error(`Unhandled request: ${method} ${url}`);
      }),
    );

    render(<MessengerWorkspace />);

    await screen.findByText("No messages yet");
    const file = new File(["png"], "diagram.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Upload attachment"), { target: { files: [file] } });
    fireEvent.change(screen.getByLabelText("Message body"), { target: { value: "Photo notes" } });
    fireEvent.click(screen.getByRole("button", { name: "Upload" }));

    expect(await screen.findByText("Photo notes")).toBeInTheDocument();
    expect(screen.getByText("diagram.png")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open" })).not.toBeInTheDocument();
    expect(MockXMLHttpRequest.instances[0].open).toHaveBeenCalledWith(
      "POST",
      "http://localhost:8000/api/v1/chats/10/attachments",
    );

    fireEvent.click(screen.getByRole("button", { name: "Preview" }));

    expect(await screen.findByRole("dialog", { name: "Attachment preview: diagram.png" })).toBeInTheDocument();
    expect(await screen.findByRole("img", { name: "diagram.png" })).toHaveAttribute("src", "blob:preview");
    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/v1/media/attachments/900",
      expect.objectContaining({
        headers: { Authorization: "Bearer test-token" },
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:preview");
  });

  it("renders authenticated video and audio attachment previews", async () => {
    const mediaMessage = message({
      attachments: [
        {
          id: 901,
          kind: "video",
          is_voice_message: false,
          original_filename: "clip.mp4",
          content_type: "video/mp4",
          size_bytes: 4096,
          checksum_sha256: null,
          width: 1280,
          height: 720,
          duration_seconds: 8,
          created_at: "2026-05-18T10:09:00Z",
          media_url: "/api/v1/media/attachments/901",
        },
        {
          id: 902,
          kind: "audio",
          is_voice_message: true,
          original_filename: "voice.ogg",
          content_type: "audio/ogg",
          size_bytes: 1024,
          checksum_sha256: null,
          width: null,
          height: null,
          duration_seconds: 4,
          created_at: "2026-05-18T10:09:00Z",
          media_url: "/api/v1/media/attachments/902",
        },
      ],
    });
    let blobIndex = 0;
    const createObjectURL = vi.fn(() => {
      blobIndex += 1;
      return `blob:media-${blobIndex}`;
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
          return jsonResponse({ items: [mediaMessage], next_before_id: null });
        }
        if (url.endsWith("/chats/10/read")) {
          return jsonResponse({
            user_id: 1,
            username: "owner",
            last_read_message_id: 1,
            last_read_at: "2026-05-18T10:06:00Z",
          });
        }
        if (url.endsWith("/media/attachments/901")) {
          expect(init?.headers).toEqual({ Authorization: "Bearer test-token" });
          return blobResponse(new Blob(["video"], { type: "video/mp4" }));
        }
        if (url.endsWith("/media/attachments/902")) {
          expect(init?.headers).toEqual({ Authorization: "Bearer test-token" });
          return blobResponse(new Blob(["audio"], { type: "audio/ogg" }));
        }
        throw new Error(`Unhandled request: ${method} ${url}`);
      }),
    );
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });

    render(<MessengerWorkspace />);

    expect(await screen.findByText("clip.mp4")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Preview" })[0]);
    expect(await screen.findByRole("dialog", { name: "Attachment preview: clip.mp4" })).toBeInTheDocument();
    expect(document.querySelector("video")).toHaveAttribute("src", "blob:media-1");

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    fireEvent.click(screen.getAllByRole("button", { name: "Preview" })[1]);
    expect(await screen.findByRole("dialog", { name: "Attachment preview: voice.ogg" })).toBeInTheDocument();
    expect(document.querySelector("audio")).toHaveAttribute("src", "blob:media-2");
  });

  it("shows an authenticated attachment preview failure state", async () => {
    const failedMessage = message({
      attachments: [
        {
          id: 903,
          kind: "image",
          is_voice_message: false,
          original_filename: "blocked.png",
          content_type: "image/png",
          size_bytes: 1024,
          checksum_sha256: null,
          width: 400,
          height: 300,
          duration_seconds: null,
          created_at: "2026-05-18T10:09:00Z",
          media_url: "/api/v1/media/attachments/903",
        },
      ],
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
          return jsonResponse({ items: [failedMessage], next_before_id: null });
        }
        if (url.endsWith("/chats/10/read")) {
          return jsonResponse({
            user_id: 1,
            username: "owner",
            last_read_message_id: 1,
            last_read_at: "2026-05-18T10:06:00Z",
          });
        }
        if (url.endsWith("/media/attachments/903")) {
          return blobResponse(new Blob(), false);
        }
        throw new Error(`Unhandled request: ${method} ${url}`);
      }),
    );

    render(<MessengerWorkspace />);

    await screen.findByText("blocked.png");
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));

    expect(await screen.findByText("Unable to load attachment")).toBeInTheDocument();
    expect(screen.getByText("Forbidden")).toBeInTheDocument();
  });

  it("opens a direct chat from the known-user selector", async () => {
    const createdDirect = chat({
      id: 10,
      kind: "direct",
      title: null,
      members: [
        { id: 1, username: "owner", avatar_url: null, status: "online", role: "owner" },
        { id: 2, username: "alex", avatar_url: null, status: "away", role: "member" },
      ],
    });

    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (url.endsWith("/chats") && method === "GET") {
          return jsonResponse([
            chat({
              id: 30,
              kind: "group",
              title: "Team",
              members: [
                { id: 1, username: "owner", avatar_url: null, status: "online", role: "owner" },
                { id: 2, username: "alex", avatar_url: null, status: "away", role: "member" },
              ],
            }),
          ]);
        }
        if (url.endsWith("/chats/30/messages?limit=30") && method === "GET") {
          return jsonResponse({ items: [], next_before_id: null });
        }
        if (url.endsWith("/chats/direct") && method === "POST") {
          expect(JSON.parse(String(init?.body))).toEqual({ participant_id: 2 });
          return jsonResponse(createdDirect);
        }
        if (url.endsWith("/chats/10/messages?limit=30") && method === "GET") {
          return jsonResponse({ items: [], next_before_id: null });
        }
        throw new Error(`Unhandled request: ${method} ${url}`);
      }),
    );

    render(<MessengerWorkspace />);

    await waitFor(() => expect(screen.getAllByText("Team").length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole("button", { name: /alexTeamOpen/i }));

    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/v1/chats/direct",
      expect.objectContaining({ method: "POST" }),
    ));
  });

  it("does not fake global username search when the backend exposes no user search endpoint", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/chats") && method === "GET") {
        return jsonResponse([]);
      }
      throw new Error(`Unhandled request: ${method} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<MessengerWorkspace />);

    expect(await screen.findByText("Global username search unavailable")).toBeInTheDocument();
    expect(screen.getByText(/no user search\/list endpoint/i)).toBeInTheDocument();
    fireEvent.change(screen.getAllByLabelText("Search known users")[0], { target: { value: "alex" } });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("/users"), expect.anything());
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
    fireEvent.click(screen.getByText("Add member IDs"));
    fireEvent.change(screen.getByLabelText("Developer group member IDs"), { target: { value: "2" } });
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

  it("starts a signaling-only call and can end it", async () => {
    const audioTrack = {
      enabled: true,
      kind: "audio",
      stop: vi.fn(),
    } as unknown as MediaStreamTrack & { kind: string };
    const mediaStream = new MockMediaStream([audioTrack]);
    const startedCall = call();
    const endedCall = call({
      status: "ended",
      ended_by_id: 1,
      ended_at: "2026-05-18T10:10:00Z",
    });

    vi.stubGlobal("MediaStream", MockMediaStream as unknown as typeof MediaStream);
    vi.stubGlobal("RTCPeerConnection", MockPeerConnection as unknown as typeof RTCPeerConnection);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => mediaStream),
      },
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
          return jsonResponse({ items: [], next_before_id: null });
        }
        if (url.endsWith("/chats/10/calls") && method === "POST") {
          return jsonResponse(startedCall);
        }
        if (url.endsWith("/calls/700/signal") && method === "POST") {
          return jsonResponse({ accepted: true });
        }
        if (url.endsWith("/calls/700/end") && method === "POST") {
          return jsonResponse(endedCall);
        }
        throw new Error(`Unhandled request: ${method} ${url}`);
      }),
    );

    render(<MessengerWorkspace />);

    await screen.findByText("No messages yet");
    fireEvent.click(screen.getByRole("button", { name: "Audio call" }));

    expect(await screen.findByText("Audio call with alex")).toBeInTheDocument();
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "http://localhost:8000/api/v1/calls/700/signal",
        expect.objectContaining({ method: "POST" }),
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "End" }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "http://localhost:8000/api/v1/calls/700/end",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    expect(audioTrack.stop).toHaveBeenCalled();
  });

  it("shows incoming calls and rejects them without opening media", async () => {
    const incoming = call({
      caller: {
        id: 2,
        username: "alex",
        avatar_url: null,
      },
      callee: {
        id: 1,
        username: "owner",
        avatar_url: null,
      },
    });
    const rejected = call({
      ...incoming,
      status: "rejected",
      ended_by_id: 1,
      ended_at: "2026-05-18T10:10:00Z",
    });

    vi.stubGlobal("RTCPeerConnection", MockPeerConnection as unknown as typeof RTCPeerConnection);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn(),
      },
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
          return jsonResponse({ items: [], next_before_id: null });
        }
        if (url.endsWith("/calls/700/reject") && method === "POST") {
          return jsonResponse(rejected);
        }
        throw new Error(`Unhandled request: ${method} ${url}`);
      }),
    );

    render(<MessengerWorkspace />);
    await screen.findByText("No messages yet");

    emitRealtime({
      type: "call.created",
      conversation_id: 10,
      payload: incoming as unknown as Record<string, unknown>,
    });

    expect(await screen.findByText("Audio call with alex")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "http://localhost:8000/api/v1/calls/700/reject",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    expect(navigator.mediaDevices?.getUserMedia).not.toHaveBeenCalled();
  });
});
