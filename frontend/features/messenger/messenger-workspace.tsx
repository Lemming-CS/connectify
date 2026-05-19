"use client";

import {
  Suspense,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useSearchParams } from "next/navigation";

import { useAuth } from "@/components/providers/auth-provider";
import { useRealtime } from "@/components/providers/realtime-provider";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { EmptyState, StatusBadge } from "@/components/ui/panel";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils/cn";
import type {
  Attachment,
  Call,
  CallKind,
  CallSignalType,
  Chat,
  ChatMember,
  ConversationRole,
  GroupCreateRequest,
  Message,
  PresenceStatus,
  Topic,
} from "@/lib/api/contracts";
import {
  acceptCall,
  endCall,
  rejectCall,
  sendCallSignal,
  startCall,
} from "@/lib/api/calls";
import { fetchAttachmentBlob } from "@/lib/api/messaging";
import { MessengerProvider, useMessenger } from "@/features/messenger/messenger-provider";
import { UserSelector, type KnownUser } from "@/features/messenger/user-selector";

const CONNECTION_COPY = {
  idle: "Offline",
  connecting: "Connecting",
  connected: "Live",
  disconnected: "Reconnecting",
} as const;

export function MessengerWorkspace() {
  return (
    <MessengerProvider>
      <Suspense fallback={<Card className="flex min-h-[78vh] items-center justify-center p-6"><Spinner /> Loading messenger</Card>}>
        <MessengerWorkspaceInner />
      </Suspense>
    </MessengerProvider>
  );
}

function MessengerWorkspaceInner() {
  const { token, user } = useAuth();
  const { manager, status } = useRealtime();
  const searchParams = useSearchParams();
  const {
    state,
    activeChat,
    activeTopic,
    activeMessages,
    activeScope,
    clearError,
    selectChat,
    selectTopic,
    loadOlderMessages,
    sendActiveMessage,
    uploadActiveAttachment,
    editChatMessage,
    deleteChatMessage,
    publishTypingState,
    createDirectConversation,
    createGroupConversation,
    addMemberToActiveChat,
    removeMemberFromActiveChat,
    updateMemberRoleInActiveChat,
    createTopicInActiveChat,
    archiveTopicInActiveChat,
  } = useMessenger();
  const [searchQuery, setSearchQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewAttachment, setPreviewAttachment] = useState<Attachment | null>(null);
  const [isVoiceMessage, setIsVoiceMessage] = useState(false);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [directParticipantId, setDirectParticipantId] = useState("");
  const [groupKind, setGroupKind] = useState<"group" | "supergroup">("group");
  const [groupTitle, setGroupTitle] = useState("");
  const [groupDescription, setGroupDescription] = useState("");
  const [groupMembers, setGroupMembers] = useState("");
  const [selectedGroupMemberIds, setSelectedGroupMemberIds] = useState<number[]>([]);
  const [topicTitle, setTopicTitle] = useState("");
  const [topicDescription, setTopicDescription] = useState("");
  const [memberUserId, setMemberUserId] = useState("");
  const [editingMessageId, setEditingMessageId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const deferredSearch = useDeferredValue(searchQuery.trim().toLowerCase());
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const olderScrollHeightRef = useRef<number | null>(null);
  const typingActiveRef = useRef(false);
  const typingTimeoutRef = useRef<number | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const pendingSignalsRef = useRef<Array<{ signal_type: CallSignalType; payload: Record<string, unknown> }>>([]);
  const [activeCall, setActiveCall] = useState<Call | null>(null);
  const [callError, setCallError] = useState<string | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [audioMuted, setAudioMuted] = useState(false);
  const [videoMuted, setVideoMuted] = useState(false);

  const directChats = state.chatIds
    .map((chatId) => state.chatsById[chatId])
    .filter(Boolean)
    .filter((chat) => chat.kind === "direct")
    .filter((chat) => matchesChat(chat, deferredSearch, user?.id ?? 0));
  const groupChats = state.chatIds
    .map((chatId) => state.chatsById[chatId])
    .filter(Boolean)
    .filter((chat) => chat.kind !== "direct")
    .filter((chat) => matchesChat(chat, deferredSearch, user?.id ?? 0));
  const topics = activeChat ? state.topicsByChatId[activeChat.id] ?? [] : [];
  const visibleTopics = topics.filter((topic) => matchesTopic(topic, deferredSearch));
  const currentMember = activeChat && user ? activeChat.members.find((member) => member.id === user.id) ?? null : null;
  const canManageMembers = Boolean(activeChat && currentMember && canManageMembersForChat(activeChat, currentMember));
  const canManageTopics = Boolean(activeChat && currentMember && canManageTopicsForChat(activeChat, currentMember));
  const canChangeRoles = currentMember?.role === "owner";
  const canCompose = Boolean(activeChat && currentMember && canSendMessageInScope(activeChat, currentMember, activeTopic));
  const typingUsers =
    activeChat && user
      ? (state.typingByChatId[activeChat.id] ?? []).filter((entry) => entry.user_id !== user.id)
      : [];
  const knownUsers = buildKnownUsers(Object.values(state.chatsById), user?.id ?? 0);
  const addableKnownUsers = activeChat
    ? knownUsers.filter((knownUser) => !activeChat.members.some((member) => member.id === knownUser.id))
    : knownUsers;
  const canUseWebRTC =
    typeof window !== "undefined" &&
    "RTCPeerConnection" in window &&
    Boolean(navigator.mediaDevices?.getUserMedia);

  useEffect(() => {
    const chatId = Number(searchParams.get("chat"));
    if (!chatId || !state.chatsById[chatId]) {
      return;
    }
    selectChat(chatId);
    const topicId = Number(searchParams.get("topic"));
    if (topicId) {
      selectTopic(topicId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, state.chatsById]);

  useEffect(() => {
    if (!scrollRef.current) {
      return;
    }
    if (olderScrollHeightRef.current != null) {
      const previousHeight = olderScrollHeightRef.current;
      const currentHeight = scrollRef.current.scrollHeight;
      scrollRef.current.scrollTop += currentHeight - previousHeight;
      olderScrollHeightRef.current = null;
      return;
    }
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [activeMessages.length, activeChat?.id, activeTopic?.id]);

  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) {
        window.clearTimeout(typingTimeoutRef.current);
      }
      cleanupCallMedia();
    };
  }, []);

  useEffect(() => {
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  useEffect(() => {
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  useEffect(() => {
    const unsubscribe = manager.subscribe((event) => {
      if (event.type === "call.created" && event.payload) {
        const call = event.payload as unknown as Call;
        if (call.conversation_id === activeChat?.id && user && [call.caller.id, call.callee.id].includes(user.id)) {
          setActiveCall(call);
        }
      }
      if (event.type === "call.updated" && event.payload) {
        const call = event.payload as unknown as Call;
        if (activeCall?.id === call.id || call.conversation_id === activeChat?.id) {
          setActiveCall(call);
          if (isTerminalCall(call)) {
            cleanupCallMedia();
          }
        }
      }
      if (event.type === "call.signal" && event.payload) {
        const callId = Number(event.payload.call_id);
        if (!activeCall || activeCall.id !== callId) {
          pendingSignalsRef.current.push({
            signal_type: event.payload.signal_type as CallSignalType,
            payload: (event.payload.payload ?? {}) as Record<string, unknown>,
          });
          return;
        }
        void handleIncomingSignal(
          event.payload.signal_type as CallSignalType,
          (event.payload.payload ?? {}) as Record<string, unknown>,
        );
      }
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCall, activeChat?.id, manager, user?.id]);

  async function handleSendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = draft.trim();
    if (!body && !selectedFile) {
      return;
    }
    setBusyKey("send-message");
    setComposerError(null);
    try {
      await sendTyping(false);
      if (selectedFile) {
        await uploadActiveAttachment({
          file: selectedFile,
          body,
          isVoiceMessage: isVoiceMessage && selectedFile.type.startsWith("audio/"),
        });
        setSelectedFile(null);
        setIsVoiceMessage(false);
      } else {
        await sendActiveMessage(body);
      }
      setDraft("");
    } catch (error) {
      setComposerError(error instanceof Error ? error.message : "Unable to send message.");
    } finally {
      setBusyKey(null);
    }
  }

  async function handleCreateDirect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const participantId = Number(directParticipantId);
    if (!participantId) {
      return;
    }
    setBusyKey("create-direct");
    try {
      await createDirectConversation(participantId);
      setDirectParticipantId("");
    } finally {
      setBusyKey(null);
    }
  }

  async function handleCreateGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const memberIds = Array.from(new Set([...selectedGroupMemberIds, ...parseNumericList(groupMembers)]));
    const payload: GroupCreateRequest = {
      title: groupTitle.trim(),
      description: groupDescription.trim() || null,
      avatar_url: null,
      member_ids: memberIds,
    };
    if (!payload.title) {
      return;
    }
    setBusyKey("create-group");
    try {
      await createGroupConversation(groupKind, payload);
      setGroupTitle("");
      setGroupDescription("");
      setGroupMembers("");
      setSelectedGroupMemberIds([]);
    } finally {
      setBusyKey(null);
    }
  }

  async function handleCreateTopic(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = topicTitle.trim();
    if (!title) {
      return;
    }
    setBusyKey("create-topic");
    try {
      await createTopicInActiveChat({
        title,
        description: topicDescription.trim() || null,
      });
      setTopicTitle("");
      setTopicDescription("");
    } finally {
      setBusyKey(null);
    }
  }

  async function handleAddMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const userId = Number(memberUserId);
    if (!userId) {
      return;
    }
    setBusyKey("add-member");
    try {
      await addMemberToActiveChat(userId);
      setMemberUserId("");
    } finally {
      setBusyKey(null);
    }
  }

  async function handleCreateDirectFromKnownUser(knownUser: KnownUser) {
    setBusyKey(`create-direct-${knownUser.id}`);
    try {
      await createDirectConversation(knownUser.id);
    } finally {
      setBusyKey(null);
    }
  }

  async function handleAddKnownMember(knownUser: KnownUser) {
    setBusyKey(`add-member-${knownUser.id}`);
    try {
      await addMemberToActiveChat(knownUser.id);
    } finally {
      setBusyKey(null);
    }
  }

  function toggleGroupMember(knownUser: KnownUser) {
    setSelectedGroupMemberIds((current) =>
      current.includes(knownUser.id)
        ? current.filter((userId) => userId !== knownUser.id)
        : [...current, knownUser.id],
    );
  }

  async function handleLoadOlder() {
    if (!scrollRef.current) {
      return;
    }
    olderScrollHeightRef.current = scrollRef.current.scrollHeight;
    await loadOlderMessages();
  }

  async function sendTyping(isTyping: boolean) {
    if (!activeChat) {
      return;
    }
    if (typingActiveRef.current === isTyping) {
      return;
    }
    typingActiveRef.current = isTyping;
    await publishTypingState(isTyping);
  }

  function handleDraftChange(value: string) {
    setDraft(value);
    if (!activeChat) {
      return;
    }
    if (!value.trim()) {
      if (typingTimeoutRef.current) {
        window.clearTimeout(typingTimeoutRef.current);
      }
      void sendTyping(false);
      return;
    }
    if (!typingActiveRef.current) {
      void sendTyping(true);
    }
    if (typingTimeoutRef.current) {
      window.clearTimeout(typingTimeoutRef.current);
    }
    typingTimeoutRef.current = window.setTimeout(() => {
      void sendTyping(false);
    }, 1500);
  }

  async function startCallFlow(kind: CallKind) {
    if (!token || !activeChat || activeChat.kind !== "direct" || !canUseWebRTC) {
      setCallError("Calls require a direct chat and browser media support.");
      return;
    }
    setBusyKey(`start-${kind}-call`);
    setCallError(null);
    try {
      const call = await startCall(token, activeChat.id, { kind });
      setActiveCall(call);
      const peer = await preparePeerConnection(call, kind);
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      await sendCallSignal(token, call.id, {
        signal_type: "offer",
        payload: sessionDescriptionPayload(offer),
      });
    } catch (error) {
      setCallError(error instanceof Error ? error.message : "Unable to start call.");
      cleanupCallMedia();
    } finally {
      setBusyKey(null);
    }
  }

  async function acceptCallFlow() {
    if (!token || !activeCall || !canUseWebRTC) {
      setCallError("This browser cannot access call media.");
      return;
    }
    setBusyKey("accept-call");
    setCallError(null);
    try {
      const call = await acceptCall(token, activeCall.id);
      setActiveCall(call);
      await preparePeerConnection(call, call.kind);
      await flushPendingSignals();
    } catch (error) {
      setCallError(error instanceof Error ? error.message : "Unable to accept call.");
      cleanupCallMedia();
    } finally {
      setBusyKey(null);
    }
  }

  async function rejectCallFlow() {
    if (!token || !activeCall) {
      return;
    }
    setBusyKey("reject-call");
    try {
      const call = await rejectCall(token, activeCall.id);
      setActiveCall(call);
      cleanupCallMedia();
    } finally {
      setBusyKey(null);
    }
  }

  async function endCallFlow() {
    if (!token || !activeCall) {
      return;
    }
    setBusyKey("end-call");
    try {
      const call = await endCall(token, activeCall.id);
      setActiveCall(call);
      cleanupCallMedia();
    } finally {
      setBusyKey(null);
    }
  }

  async function preparePeerConnection(call: Call, kind: CallKind) {
    if (!token) {
      throw new Error("No active session");
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: kind === "video",
    });
    localStreamRef.current = stream;
    setLocalStream(stream);
    const remote = new MediaStream();
    setRemoteStream(remote);
    const peer = new RTCPeerConnection();
    peerRef.current = peer;
    stream.getTracks().forEach((track) => peer.addTrack(track, stream));
    peer.addEventListener("track", (event) => {
      event.streams[0]?.getTracks().forEach((track) => remote.addTrack(track));
      setRemoteStream(remote);
    });
    peer.addEventListener("icecandidate", (event) => {
      if (event.candidate) {
        void sendCallSignal(token, call.id, {
          signal_type: "ice_candidate",
          payload: event.candidate.toJSON() as Record<string, unknown>,
        });
      }
    });
    return peer;
  }

  async function flushPendingSignals() {
    const signals = [...pendingSignalsRef.current];
    pendingSignalsRef.current = [];
    for (const signal of signals) {
      await handleIncomingSignal(signal.signal_type, signal.payload);
    }
  }

  async function handleIncomingSignal(signalType: CallSignalType, payload: Record<string, unknown>) {
    if (!token || !activeCall) {
      pendingSignalsRef.current.push({ signal_type: signalType, payload });
      return;
    }
    const peer = peerRef.current ?? (await preparePeerConnection(activeCall, activeCall.kind));
    if (signalType === "offer") {
      await peer.setRemoteDescription(new RTCSessionDescription(payload as unknown as RTCSessionDescriptionInit));
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      await sendCallSignal(token, activeCall.id, {
        signal_type: "answer",
        payload: sessionDescriptionPayload(answer),
      });
    }
    if (signalType === "answer") {
      await peer.setRemoteDescription(new RTCSessionDescription(payload as unknown as RTCSessionDescriptionInit));
    }
    if (signalType === "ice_candidate") {
      await peer.addIceCandidate(new RTCIceCandidate(payload as RTCIceCandidateInit));
    }
  }

  function cleanupCallMedia() {
    peerRef.current?.close();
    peerRef.current = null;
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    setLocalStream(null);
    setRemoteStream(null);
    pendingSignalsRef.current = [];
    setAudioMuted(false);
    setVideoMuted(false);
  }

  function toggleAudio() {
    localStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !track.enabled;
      setAudioMuted(!track.enabled);
    });
  }

  function toggleVideo() {
    localStreamRef.current?.getVideoTracks().forEach((track) => {
      track.enabled = !track.enabled;
      setVideoMuted(!track.enabled);
    });
  }

  return (
    <div className="grid flex-1 gap-4 xl:grid-cols-[340px_minmax(0,1fr)_320px]">
      <Card
        className={cn(
          "flex min-h-[78vh] flex-col overflow-hidden",
          activeChat ? "max-xl:hidden" : "",
        )}
      >
        <div className="border-b border-[var(--color-card-border)] px-5 py-5">
          <p className="text-xs uppercase tracking-[0.24em] text-[var(--color-muted)]">Workspace</p>
          <div className="mt-3 flex items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold text-[var(--color-ink)]">Messages</h1>
              <p className="mt-1 text-sm text-[var(--color-muted)]">Direct chats, groups, supergroups, and topics.</p>
            </div>
            <span className="rounded-full border border-[var(--color-card-border)] bg-white/80 px-3 py-1 text-xs text-[var(--color-muted)]">
              {CONNECTION_COPY[status]}
            </span>
          </div>
          <Input
            aria-label="Search chats"
            className="mt-4"
            placeholder="Search chats and topics"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
          {state.error ? (
            <Banner tone="danger">
              <div className="flex items-center justify-between gap-3">
                <span>{state.error}</span>
                <button className="text-xs font-semibold uppercase tracking-[0.2em]" onClick={clearError} type="button">
                  Clear
                </button>
              </div>
            </Banner>
          ) : null}

          <SidebarSection title="Direct chats" emptyCopy="No direct chats yet.">
            {state.chatListLoading && !state.chatListLoaded ? (
              <EmptyState className="flex items-center gap-3">
                <Spinner />
                Loading conversations
              </EmptyState>
            ) : (
              directChats.map((chat) => (
                <SidebarChatButton
                  key={chat.id}
                  chat={chat}
                  isActive={chat.id === activeChat?.id}
                  userId={user?.id ?? 0}
                  onClick={() => selectChat(chat.id)}
                />
              ))
            )}
          </SidebarSection>

          <SidebarSection title="Groups" emptyCopy="No groups yet.">
            {groupChats.map((chat) => (
              <SidebarChatButton
                key={chat.id}
                chat={chat}
                isActive={chat.id === activeChat?.id}
                userId={user?.id ?? 0}
                onClick={() => selectChat(chat.id)}
              />
            ))}
          </SidebarSection>

          {activeChat?.kind === "supergroup" ? (
            <SidebarSection title="Topics" emptyCopy="No topics available.">
              {visibleTopics.map((topic) => (
                <button
                  key={topic.id}
                  className={cn(
                    "flex w-full items-start justify-between rounded-2xl border px-4 py-3 text-left transition",
                    topic.id === activeTopic?.id
                      ? "border-[var(--color-ink)] bg-[rgba(23,50,74,0.08)]"
                      : "border-[var(--color-card-border)] bg-white/70 hover:bg-white",
                  )}
                  type="button"
                  onClick={() => selectTopic(topic.id)}
                >
                  <div>
                    <p className="text-sm font-semibold text-[var(--color-ink)]">{topic.title}</p>
                    <p className="mt-1 text-xs text-[var(--color-muted)]">
                      {topic.archived_at ? "Archived" : topic.is_general ? "General topic" : topic.description || "Topic"}
                    </p>
                  </div>
                  {topic.is_closed ? (
                    <span className="rounded-full bg-[rgba(23,50,74,0.08)] px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-[var(--color-muted)]">
                      Closed
                    </span>
                  ) : null}
                </button>
              ))}
            </SidebarSection>
          ) : null}

          <SidebarSection title="Start a direct chat" emptyCopy="">
            <UserSelector
              actionLabel="Open"
              emptyCopy="No known users yet."
              users={knownUsers}
              onSelect={(knownUser) => void handleCreateDirectFromKnownUser(knownUser)}
            />
            <UnavailableUserSearch />
            <DeveloperFallback summary="Open by user ID">
              <form className="space-y-3" onSubmit={handleCreateDirect}>
                <Field label="User ID" hint="Temporary backend-only path until a user directory API exists.">
                  <Input
                    aria-label="Developer direct user ID"
                    inputMode="numeric"
                    min={1}
                    placeholder="42"
                    type="number"
                    value={directParticipantId}
                    onChange={(event) => setDirectParticipantId(event.target.value)}
                  />
                </Field>
                <Button busy={busyKey === "create-direct"} className="w-full" type="submit">
                  Open direct chat
                </Button>
              </form>
            </DeveloperFallback>
          </SidebarSection>

          <SidebarSection title="Create a group" emptyCopy="">
            <form className="space-y-3" onSubmit={handleCreateGroup}>
              <Field label="Kind">
                <Select
                  aria-label="Group kind"
                  value={groupKind}
                  onChange={(event) => setGroupKind(event.target.value as "group" | "supergroup")}
                >
                  <option value="group">Group</option>
                  <option value="supergroup">Supergroup</option>
                </Select>
              </Field>
              <Field label="Title">
                <Input aria-label="Group title" value={groupTitle} onChange={(event) => setGroupTitle(event.target.value)} />
              </Field>
              <Field label="Description">
                <Textarea
                  aria-label="Group description"
                  rows={3}
                  value={groupDescription}
                  onChange={(event) => setGroupDescription(event.target.value)}
                />
              </Field>
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-[var(--color-ink)]">Members</p>
                  <StatusBadge>{selectedGroupMemberIds.length} selected</StatusBadge>
                </div>
                <UserSelector
                  emptyCopy="No known users available from existing chats yet."
                  mode="multiple"
                  selectedIds={selectedGroupMemberIds}
                  users={knownUsers}
                  onToggle={toggleGroupMember}
                />
              </div>
              <DeveloperFallback summary="Add member IDs">
                <Field label="Member IDs" hint="Comma-separated numeric user IDs for local testing.">
                  <Input
                    aria-label="Developer group member IDs"
                    placeholder="7, 11, 19"
                    value={groupMembers}
                    onChange={(event) => setGroupMembers(event.target.value)}
                  />
                </Field>
              </DeveloperFallback>
              <Button busy={busyKey === "create-group"} className="w-full" type="submit">
                Create {groupKind === "group" ? "group" : "supergroup"}
              </Button>
            </form>
          </SidebarSection>
        </div>
      </Card>

      <Card className={cn("flex min-h-[78vh] flex-col overflow-hidden", !activeChat ? "max-xl:order-first" : "")}>
        {activeChat ? (
          <>
            <div className="border-b border-[var(--color-card-border)] px-5 py-4">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <button
                    className="rounded-full border border-[var(--color-card-border)] px-3 py-2 text-xs uppercase tracking-[0.2em] text-[var(--color-muted)] xl:hidden"
                    type="button"
                    onClick={() => selectChat(null)}
                  >
                    Back
                  </button>
                  <div>
                    <p className="text-xs uppercase tracking-[0.24em] text-[var(--color-muted)]">
                      {activeChat.kind === "direct" ? "Direct chat" : activeChat.kind === "group" ? "Group" : "Supergroup"}
                    </p>
                    <h2 className="mt-1 text-2xl font-semibold text-[var(--color-ink)]">
                      {getChatTitle(activeChat, user?.id ?? 0)}
                    </h2>
                    <p className="mt-1 text-sm text-[var(--color-muted)]">
                      {activeTopic ? `${activeTopic.title} topic` : activeChat.description || `${activeChat.members.length} members`}
                    </p>
                  </div>
                </div>
                <div className="text-right text-sm text-[var(--color-muted)]">
                  <p>{activeChat.members.length} members</p>
                  <p>{CONNECTION_COPY[status]}</p>
                </div>
              </div>
              {activeChat.kind === "direct" ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    busy={busyKey === "start-audio-call"}
                    disabled={!canUseWebRTC || Boolean(activeCall && !isTerminalCall(activeCall))}
                    type="button"
                    variant="secondary"
                    onClick={() => void startCallFlow("audio")}
                  >
                    Audio call
                  </Button>
                  <Button
                    busy={busyKey === "start-video-call"}
                    disabled={!canUseWebRTC || Boolean(activeCall && !isTerminalCall(activeCall))}
                    type="button"
                    variant="secondary"
                    onClick={() => void startCallFlow("video")}
                  >
                    Video call
                  </Button>
                </div>
              ) : null}
              {activeChat.kind === "supergroup" && !activeTopic ? (
                <Banner className="mt-3">Select a topic to load supergroup messages.</Banner>
              ) : null}
              {!canUseWebRTC && activeChat.kind === "direct" ? (
                <Banner className="mt-3">This browser cannot access WebRTC media devices.</Banner>
              ) : null}
              {callError ? <Banner className="mt-3" tone="danger">{callError}</Banner> : null}
              {activeCall && !isTerminalCall(activeCall) ? (
                <CallPanel
                  activeCall={activeCall}
                  audioMuted={audioMuted}
                  busyKey={busyKey}
                  currentUserId={user?.id ?? 0}
                  localVideoRef={localVideoRef}
                  remoteVideoRef={remoteVideoRef}
                  videoMuted={videoMuted}
                  onAccept={() => void acceptCallFlow()}
                  onEnd={() => void endCallFlow()}
                  onReject={() => void rejectCallFlow()}
                  onToggleAudio={toggleAudio}
                  onToggleVideo={toggleVideo}
                />
              ) : null}
              {activeTopic?.archived_at ? (
                <Banner className="mt-3">This topic is archived. Only history remains available.</Banner>
              ) : null}
              {activeTopic?.is_closed && !hasModeratorRole(currentMember) ? (
                <Banner className="mt-3">This topic is closed. Only admins and owners can keep posting here.</Banner>
              ) : null}
            </div>

            <div
              ref={scrollRef}
              className="flex-1 overflow-y-auto px-5 py-5"
              onScroll={(event) => {
                if (event.currentTarget.scrollTop < 120 && activeScope.nextBeforeId && !activeScope.isLoadingMore) {
                  void handleLoadOlder();
                }
              }}
            >
              {activeScope.isLoading && !activeScope.initialized ? (
                <div className="flex h-full items-center justify-center gap-3 text-sm text-[var(--color-muted)]">
                  <Spinner />
                  Loading messages
                </div>
              ) : (
                <div className="space-y-4">
                  {activeScope.nextBeforeId ? (
                    <div className="flex justify-center">
                      <Button busy={activeScope.isLoadingMore} type="button" variant="ghost" onClick={() => void handleLoadOlder()}>
                        Load older messages
                      </Button>
                    </div>
                  ) : null}
                  {activeMessages.length === 0 ? (
                    <EmptyState className="bg-white/65 px-6 py-10 text-center">
                      <p className="text-sm font-semibold text-[var(--color-ink)]">No messages yet</p>
                      <p className="mt-2 text-sm text-[var(--color-muted)]">
                        Send the first message to start this conversation.
                      </p>
                    </EmptyState>
                  ) : (
                    activeMessages.map((message) => (
                      <MessageBubble
                        key={message.id}
                        currentUserId={user?.id ?? 0}
                        editingMessageId={editingMessageId}
                        editDraft={editDraft}
                        member={currentMember}
                        chat={activeChat}
                        message={message}
                        onAttachmentPreview={setPreviewAttachment}
                        onDelete={async () => {
                          setBusyKey(`delete-${message.id}`);
                          try {
                            await deleteChatMessage(message.id);
                          } finally {
                            setBusyKey(null);
                          }
                        }}
                        onEditDraftChange={setEditDraft}
                        onEditStart={() => {
                          setEditingMessageId(message.id);
                          setEditDraft(message.body ?? "");
                        }}
                        onEditSubmit={async () => {
                          const body = editDraft.trim();
                          if (!body) {
                            return;
                          }
                          setBusyKey(`edit-${message.id}`);
                          try {
                            await editChatMessage(message.id, body);
                            setEditingMessageId(null);
                            setEditDraft("");
                          } finally {
                            setBusyKey(null);
                          }
                        }}
                        onEditCancel={() => {
                          setEditingMessageId(null);
                          setEditDraft("");
                        }}
                        busyKey={busyKey}
                      />
                    ))
                  )}
                </div>
              )}
            </div>

            <div className="border-t border-[var(--color-card-border)] px-5 py-4">
              {typingUsers.length > 0 ? (
                <p className="mb-3 text-sm text-[var(--color-muted)]">
                  {typingUsers.map((entry) => entry.username).join(", ")} {typingUsers.length === 1 ? "is" : "are"} typing
                </p>
              ) : null}
              {composerError ? <Banner className="mb-3" tone="danger">{composerError}</Banner> : null}
              {state.upload ? (
                <div className="mb-3 rounded-lg border border-[var(--color-card-border)] bg-white/75 px-3 py-3">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="truncate font-semibold text-[var(--color-ink)]">{state.upload.fileName}</span>
                    <span className="shrink-0 text-[var(--color-muted)]">{state.upload.progress}%</span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--color-card-strong)]">
                    <div
                      className="h-full bg-[var(--color-accent)] transition-all"
                      style={{ width: `${state.upload.progress}%` }}
                    />
                  </div>
                  {state.upload.error ? <p className="mt-2 text-sm text-[var(--color-danger)]">{state.upload.error}</p> : null}
                </div>
              ) : null}
              {selectedFile ? (
                <AttachmentDraft
                  file={selectedFile}
                  isVoiceMessage={isVoiceMessage}
                  onClear={() => {
                    setSelectedFile(null);
                    setIsVoiceMessage(false);
                  }}
                  onVoiceChange={setIsVoiceMessage}
                />
              ) : null}
              <form className="space-y-3" onSubmit={handleSendMessage}>
                <Textarea
                  aria-label="Message body"
                  disabled={!canCompose}
                  placeholder={canCompose ? "Write a message or attach a file" : "You cannot post in this chat right now"}
                  rows={3}
                  value={draft}
                  onChange={(event) => handleDraftChange(event.target.value)}
                />
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-[var(--color-muted)]">
                    {activeChat.kind === "supergroup"
                      ? "Messages stay isolated inside the selected topic."
                      : "Read state updates automatically when new messages arrive."}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-2xl bg-[var(--color-card-strong)] px-4 py-2 text-sm font-semibold text-[var(--color-ink)] hover:bg-[var(--color-card-border)]">
                      Attach
                      <input
                        aria-label="Upload attachment"
                        className="sr-only"
                        type="file"
                        accept="image/*,video/*,audio/*,.pdf,.zip,.json,.csv,.txt,application/octet-stream"
                        onChange={(event) => {
                          const file = event.target.files?.[0] ?? null;
                          setSelectedFile(file);
                          setIsVoiceMessage(false);
                          setComposerError(null);
                          event.currentTarget.value = "";
                        }}
                      />
                    </label>
                    <Button
                      busy={busyKey === "send-message"}
                      disabled={!canCompose || (!draft.trim() && !selectedFile)}
                      type="submit"
                    >
                      {selectedFile ? "Upload" : "Send"}
                    </Button>
                  </div>
                </div>
              </form>
            </div>
          </>
        ) : (
          <div className="flex h-full min-h-[78vh] flex-col items-center justify-center px-8 text-center">
            <p className="text-xs uppercase tracking-[0.24em] text-[var(--color-muted)]">Messenger</p>
            <h2 className="mt-4 max-w-xl text-4xl font-semibold text-[var(--color-ink)]">Select a conversation or create a new one.</h2>
            <p className="mt-4 max-w-xl text-sm leading-7 text-[var(--color-muted)]">
              Search loaded chats, pick from known users, or use the isolated developer fallback while backend user discovery is unavailable.
            </p>
          </div>
        )}
      </Card>

      {previewAttachment && token ? (
        <AttachmentPreviewModal
          key={previewAttachment.id}
          attachment={previewAttachment}
          token={token}
          onClose={() => setPreviewAttachment(null)}
        />
      ) : null}

      <Card className="hidden min-h-[78vh] flex-col overflow-hidden xl:flex">
        <div className="border-b border-[var(--color-card-border)] px-5 py-5">
          <p className="text-xs uppercase tracking-[0.24em] text-[var(--color-muted)]">Details</p>
          <h3 className="mt-3 text-2xl font-semibold text-[var(--color-ink)]">
            {activeChat ? getChatTitle(activeChat, user?.id ?? 0) : "No chat selected"}
          </h3>
          <p className="mt-2 text-sm text-[var(--color-muted)]">
            {activeChat
              ? activeChat.kind === "direct"
                ? "Direct conversation details and read state."
                : "Members, roles, and moderator controls."
              : "Select a conversation to manage members and topics."}
          </p>
        </div>
        {activeChat ? (
          <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
            <SidebarSection title="Members" emptyCopy="">
              <div className="space-y-3">
                {activeChat.members.map((member) => {
                  const receipt = activeChat.read_states.find((item) => item.user_id === member.id) ?? null;
                  return (
                    <div key={member.id} className="rounded-2xl border border-[var(--color-card-border)] bg-white/72 px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-[var(--color-ink)]">{member.username}</p>
                          <p className="mt-1 text-xs uppercase tracking-[0.2em] text-[var(--color-muted)]">
                            {member.role} · {formatPresence(member.status)}
                          </p>
                          <p className="mt-2 text-xs text-[var(--color-muted)]">
                            {receipt?.last_read_message_id
                              ? `Read through message #${receipt.last_read_message_id}`
                              : "No read receipt yet"}
                          </p>
                        </div>
                        {currentMember ? (
                          <MemberActions
                            actor={currentMember}
                            busyKey={busyKey}
                            canChangeRoles={canChangeRoles}
                            canManageMembers={canManageMembers}
                            chat={activeChat}
                            member={member}
                            onRemove={async () => {
                              setBusyKey(`remove-member-${member.id}`);
                              try {
                                await removeMemberFromActiveChat(member.id);
                              } finally {
                                setBusyKey(null);
                              }
                            }}
                            onRoleChange={async (role) => {
                              setBusyKey(`role-${member.id}-${role}`);
                              try {
                                await updateMemberRoleInActiveChat(member.id, role);
                              } finally {
                                setBusyKey(null);
                              }
                            }}
                          />
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </SidebarSection>

            {canManageMembers ? (
              <SidebarSection title="Add member" emptyCopy="">
                <UserSelector
                  actionLabel="Add"
                  emptyCopy="No known users outside this chat yet."
                  users={addableKnownUsers}
                  onSelect={(knownUser) => void handleAddKnownMember(knownUser)}
                />
                <DeveloperFallback summary="Add by user ID">
                  <form className="space-y-3" onSubmit={handleAddMember}>
                    <Field label="User ID" hint="Temporary backend-only path until a user directory API exists.">
                      <Input
                        aria-label="Developer member user ID"
                        inputMode="numeric"
                        min={1}
                        type="number"
                        value={memberUserId}
                        onChange={(event) => setMemberUserId(event.target.value)}
                      />
                    </Field>
                    <Button busy={busyKey === "add-member"} className="w-full" type="submit">
                      Add member
                    </Button>
                  </form>
                </DeveloperFallback>
              </SidebarSection>
            ) : null}

            {activeChat.kind === "supergroup" && canManageTopics ? (
              <>
                <SidebarSection title="Create topic" emptyCopy="">
                  <form className="space-y-3" onSubmit={handleCreateTopic}>
                    <Field label="Title">
                      <Input aria-label="Topic title" value={topicTitle} onChange={(event) => setTopicTitle(event.target.value)} />
                    </Field>
                    <Field label="Description">
                      <Textarea
                        aria-label="Topic description"
                        rows={3}
                        value={topicDescription}
                        onChange={(event) => setTopicDescription(event.target.value)}
                      />
                    </Field>
                    <Button busy={busyKey === "create-topic"} className="w-full" type="submit">
                      Create topic
                    </Button>
                  </form>
                </SidebarSection>

                {activeTopic && !activeTopic.is_general && !activeTopic.archived_at ? (
                  <SidebarSection title="Current topic" emptyCopy="">
                    <Button
                      busy={busyKey === `archive-topic-${activeTopic.id}`}
                      className="w-full"
                      type="button"
                      variant="secondary"
                      onClick={async () => {
                        setBusyKey(`archive-topic-${activeTopic.id}`);
                        try {
                          await archiveTopicInActiveChat(activeTopic.id);
                        } finally {
                          setBusyKey(null);
                        }
                      }}
                    >
                      Archive topic
                    </Button>
                  </SidebarSection>
                ) : null}
              </>
            ) : null}
          </div>
        ) : null}
      </Card>
    </div>
  );
}

function SidebarSection({
  title,
  emptyCopy,
  children,
}: {
  title: string;
  emptyCopy: string;
  children: React.ReactNode;
}) {
  const items = Array.isArray(children) ? children.filter(Boolean) : children;
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--color-muted)]">{title}</h2>
      </div>
      {emptyCopy && (!items || (Array.isArray(items) && items.length === 0)) ? (
        <EmptyState>{emptyCopy}</EmptyState>
      ) : (
        children
      )}
    </section>
  );
}

function DeveloperFallback({
  summary,
  children,
}: {
  summary: string;
  children: React.ReactNode;
}) {
  return (
    <details className="rounded-lg border border-dashed border-[var(--color-card-border)] bg-white/50 px-3 py-3 text-sm text-[var(--color-muted)]">
      <summary className="cursor-pointer font-semibold text-[var(--color-ink)]">{summary}</summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

function UnavailableUserSearch() {
  return (
    <div className="rounded-lg border border-[var(--color-card-border)] bg-white/65 px-3 py-3 text-sm">
      <p className="font-semibold text-[var(--color-ink)]">Global username search unavailable</p>
      <p className="mt-1 leading-6 text-[var(--color-muted)]">
        The backend currently exposes profile and chat APIs, but no user search/list endpoint. Known users remain searchable
        from loaded chats; the numeric ID fallback stays isolated for local development.
      </p>
    </div>
  );
}

function SidebarChatButton({
  chat,
  isActive,
  onClick,
  userId,
}: {
  chat: Chat;
  isActive: boolean;
  onClick: () => void;
  userId: number;
}) {
  return (
    <button
      className={cn(
        "flex w-full items-start justify-between rounded-2xl border px-4 py-3 text-left transition",
        isActive
          ? "border-[var(--color-ink)] bg-[rgba(23,50,74,0.08)]"
          : "border-[var(--color-card-border)] bg-white/72 hover:bg-white",
      )}
      type="button"
      onClick={onClick}
    >
      <div>
        <p className="text-sm font-semibold text-[var(--color-ink)]">{getChatTitle(chat, userId)}</p>
        <p className="mt-1 text-sm text-[var(--color-muted)]">{getChatSubtitle(chat, userId)}</p>
      </div>
      <StatusBadge className="shrink-0">{chat.kind}</StatusBadge>
    </button>
  );
}

function MessageBubble({
  chat,
  member,
  message,
  currentUserId,
  editingMessageId,
  editDraft,
  onEditStart,
  onEditDraftChange,
  onEditSubmit,
  onEditCancel,
  onDelete,
  onAttachmentPreview,
  busyKey,
}: {
  chat: Chat;
  member: ChatMember | null;
  message: Message;
  currentUserId: number;
  editingMessageId: number | null;
  editDraft: string;
  onEditStart: () => void;
  onEditDraftChange: (value: string) => void;
  onEditSubmit: () => void;
  onEditCancel: () => void;
  onDelete: () => void;
  onAttachmentPreview: (attachment: Attachment) => void;
  busyKey: string | null;
}) {
  const isOwnMessage = message.sender.id === currentUserId;
  const canManage = member ? canManageMessage(chat, member, message) : false;
  const isEditing = editingMessageId === message.id;

  return (
    <div className={cn("flex", isOwnMessage ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[min(38rem,100%)] rounded-[28px] border px-4 py-3 shadow-[0_16px_40px_rgba(31,52,73,0.08)]",
          isOwnMessage
            ? "border-[rgba(23,50,74,0.12)] bg-[rgba(23,50,74,0.92)] text-white"
            : "border-[var(--color-card-border)] bg-white/90 text-[var(--color-ink)]",
        )}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className={cn("text-sm font-semibold", isOwnMessage ? "text-white/88" : "text-[var(--color-ink)]")}>
              {message.sender.username}
            </p>
            <p className={cn("mt-1 text-xs", isOwnMessage ? "text-white/56" : "text-[var(--color-muted)]")}>
              {formatDate(message.created_at)}
              {message.edited_at ? " · edited" : ""}
            </p>
          </div>
          {canManage && !message.deleted_at ? (
            <div className="flex items-center gap-2">
              <button
                className={cn("text-xs font-semibold uppercase tracking-[0.2em]", isOwnMessage ? "text-white/70" : "text-[var(--color-muted)]")}
                type="button"
                onClick={onEditStart}
              >
                Edit
              </button>
              <button
                className={cn("text-xs font-semibold uppercase tracking-[0.2em]", isOwnMessage ? "text-white/70" : "text-[var(--color-muted)]")}
                type="button"
                onClick={onDelete}
              >
                {busyKey === `delete-${message.id}` ? "..." : "Delete"}
              </button>
            </div>
          ) : null}
        </div>

        {isEditing ? (
          <div className="mt-3 space-y-3">
            <Textarea rows={3} value={editDraft} onChange={(event) => onEditDraftChange(event.target.value)} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={onEditCancel}>
                Cancel
              </Button>
              <Button busy={busyKey === `edit-${message.id}`} type="button" onClick={onEditSubmit}>
                Save
              </Button>
            </div>
          </div>
        ) : message.deleted_at ? (
          <p className={cn("mt-3 text-sm italic", isOwnMessage ? "text-white/65" : "text-[var(--color-muted)]")}>
            This message was deleted.
          </p>
        ) : (
          <>
            {message.body ? <p className="mt-3 whitespace-pre-wrap text-sm leading-7">{message.body}</p> : null}
            {message.attachments.length > 0 ? (
              <div className="mt-3 space-y-2">
                {message.attachments.map((attachment) => (
                  <AttachmentPreview
                    key={attachment.id}
                    attachment={attachment}
                    isOwnMessage={isOwnMessage}
                    onPreview={() => onAttachmentPreview(attachment)}
                  />
                ))}
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function AttachmentDraft({
  file,
  isVoiceMessage,
  onClear,
  onVoiceChange,
}: {
  file: File;
  isVoiceMessage: boolean;
  onClear: () => void;
  onVoiceChange: (value: boolean) => void;
}) {
  const previewUrl = useMemo(
    () =>
      file.type.startsWith("image/") || file.type.startsWith("video/") || file.type.startsWith("audio/")
        ? URL.createObjectURL(file)
        : null,
    [file],
  );

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  return (
    <div className="mb-3 rounded-lg border border-[var(--color-card-border)] bg-white/75 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-[var(--color-ink)]">{file.name}</p>
          <p className="mt-1 text-xs text-[var(--color-muted)]">{formatBytes(file.size)} · {file.type || "file"}</p>
        </div>
        <button className="text-xs font-semibold text-[var(--color-muted)]" type="button" onClick={onClear}>
          Remove
        </button>
      </div>
      {previewUrl && file.type.startsWith("image/") ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img alt="" className="mt-3 max-h-48 rounded-lg object-contain" src={previewUrl} />
      ) : null}
      {previewUrl && file.type.startsWith("video/") ? (
        <video className="mt-3 max-h-48 w-full rounded-lg" controls src={previewUrl} />
      ) : null}
      {previewUrl && file.type.startsWith("audio/") ? (
        <div className="mt-3 space-y-3">
          <audio className="w-full" controls src={previewUrl} />
          <label className="flex items-center gap-2 text-sm text-[var(--color-muted)]">
            <input
              checked={isVoiceMessage}
              type="checkbox"
              onChange={(event) => onVoiceChange(event.target.checked)}
            />
            Send as voice message
          </label>
        </div>
      ) : null}
    </div>
  );
}

function AttachmentPreview({
  attachment,
  isOwnMessage,
  onPreview,
}: {
  attachment: Message["attachments"][number];
  isOwnMessage: boolean;
  onPreview: () => void;
}) {
  const label = attachment.original_filename || `${attachment.kind} attachment`;
  const frameClass = cn(
    "rounded-lg border px-3 py-2 text-sm",
    isOwnMessage
      ? "border-white/12 bg-white/10 text-white/88"
      : "border-[var(--color-card-border)] bg-[var(--color-page)] text-[var(--color-ink)]",
  );

  return (
    <div className={frameClass}>
      {attachment.kind === "image" ? (
        <div className="flex min-h-28 items-center justify-center rounded-lg border border-dashed border-current/20 bg-black/5 px-4 py-6 text-center text-xs opacity-75">
          Authenticated image preview
        </div>
      ) : null}
      {attachment.kind === "video" ? (
        <div className="flex min-h-28 items-center justify-center rounded-lg border border-dashed border-current/20 bg-black/5 px-4 py-6 text-center text-xs opacity-75">
          Authenticated video preview
        </div>
      ) : null}
      {attachment.kind === "audio" ? (
        <div className="rounded-lg border border-dashed border-current/20 bg-black/5 px-4 py-3 text-xs opacity-75">
          {attachment.is_voice_message ? "Voice message" : "Authenticated audio preview"}
        </div>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <span className="truncate">{attachment.is_voice_message ? `Voice message · ${label}` : label}</span>
        <button className="text-xs font-semibold underline" type="button" onClick={onPreview}>
          Preview
        </button>
      </div>
      <p className="mt-1 text-xs opacity-70">{formatBytes(attachment.size_bytes)}</p>
    </div>
  );
}

function AttachmentPreviewModal({
  attachment,
  token,
  onClose,
}: {
  attachment: Attachment;
  token: string;
  onClose: () => void;
}) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const label = attachment.original_filename || `${attachment.kind} attachment`;
  const isPreviewable = attachment.kind === "image" || attachment.kind === "video" || attachment.kind === "audio";
  const isOpenableFile = attachment.content_type === "application/pdf" || attachment.content_type?.startsWith("text/");

  useEffect(() => {
    let isActive = true;
    let nextUrl: string | null = null;

    async function loadAttachment() {
      try {
        const blob = await fetchAttachmentBlob(token, attachment, { download: !isPreviewable });
        if (!isActive) {
          return;
        }
        nextUrl = URL.createObjectURL(blob);
        setObjectUrl(nextUrl);
      } catch (caughtError) {
        if (isActive) {
          setError(caughtError instanceof Error ? caughtError.message : "Unable to load attachment.");
        }
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    }

    void loadAttachment();
    return () => {
      isActive = false;
      if (nextUrl) {
        URL.revokeObjectURL(nextUrl);
      }
    };
  }, [attachment, isPreviewable, token]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  function downloadAttachment() {
    if (!objectUrl) {
      return;
    }
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = label;
    document.body.append(link);
    link.click();
    link.remove();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-6"
      role="dialog"
      aria-modal="true"
      aria-label={`Attachment preview: ${label}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-[24px] border border-[var(--color-card-border)] bg-[var(--color-card)] shadow-[0_30px_90px_rgba(0,0,0,0.35)]">
        <div className="flex items-start justify-between gap-4 border-b border-[var(--color-card-border)] px-4 py-4 sm:px-5">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-[var(--color-ink)]">{label}</p>
            <p className="mt-1 text-xs text-[var(--color-muted)]">
              {attachment.is_voice_message ? "Voice message" : attachment.content_type || attachment.kind} · {formatBytes(attachment.size_bytes)}
            </p>
          </div>
          <button
            className="rounded-full border border-[var(--color-card-border)] px-3 py-2 text-xs font-semibold text-[var(--color-muted)]"
            type="button"
            autoFocus
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <div className="min-h-64 flex-1 overflow-auto p-4 sm:p-5">
          {isLoading ? (
            <div className="flex min-h-64 items-center justify-center gap-3 text-sm text-[var(--color-muted)]">
              <Spinner />
              Loading attachment
            </div>
          ) : null}
          {error ? (
            <Banner tone="danger">
              <div>
                <p className="font-semibold">Unable to load attachment</p>
                <p className="mt-1 text-sm">{error}</p>
              </div>
            </Banner>
          ) : null}
          {!isLoading && !error && objectUrl ? (
            <div className="space-y-4">
              {attachment.kind === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img alt={label} className="mx-auto max-h-[70vh] rounded-lg object-contain" src={objectUrl} />
              ) : null}
              {attachment.kind === "video" ? (
                <video className="max-h-[70vh] w-full rounded-lg bg-black" controls src={objectUrl} />
              ) : null}
              {attachment.kind === "audio" ? (
                <div className="rounded-lg border border-[var(--color-card-border)] bg-white/70 p-4">
                  <audio className="w-full" controls src={objectUrl} />
                </div>
              ) : null}
              {attachment.kind !== "image" && attachment.kind !== "video" && attachment.kind !== "audio" ? (
                <EmptyState className="text-center">
                  <p className="font-semibold text-[var(--color-ink)]">No inline preview for this file type.</p>
                  <p className="mt-2">Download it after the authenticated fetch completes.</p>
                </EmptyState>
              ) : null}
              <div className="flex flex-wrap justify-end gap-2">
                {isOpenableFile ? (
                  <a
                    className="inline-flex min-h-11 items-center rounded-2xl bg-[var(--color-card-strong)] px-4 py-2 text-sm font-semibold text-[var(--color-ink)]"
                    href={objectUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open blob
                  </a>
                ) : null}
                <Button type="button" variant="secondary" onClick={downloadAttachment}>
                  Download
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function CallPanel({
  activeCall,
  audioMuted,
  busyKey,
  currentUserId,
  localVideoRef,
  remoteVideoRef,
  videoMuted,
  onAccept,
  onEnd,
  onReject,
  onToggleAudio,
  onToggleVideo,
}: {
  activeCall: Call;
  audioMuted: boolean;
  busyKey: string | null;
  currentUserId: number;
  localVideoRef: React.RefObject<HTMLVideoElement | null>;
  remoteVideoRef: React.RefObject<HTMLVideoElement | null>;
  videoMuted: boolean;
  onAccept: () => void;
  onEnd: () => void;
  onReject: () => void;
  onToggleAudio: () => void;
  onToggleVideo: () => void;
}) {
  const isIncoming = activeCall.status === "ringing" && activeCall.callee.id === currentUserId;
  const peer = activeCall.caller.id === currentUserId ? activeCall.callee : activeCall.caller;

  return (
    <div className="mt-3 rounded-lg border border-[var(--color-card-border)] bg-white/75 p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-[var(--color-ink)]">
            {activeCall.kind === "video" ? "Video" : "Audio"} call with {peer.username}
          </p>
          <p className="mt-1 text-xs capitalize text-[var(--color-muted)]">{activeCall.status}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isIncoming ? (
            <>
              <Button busy={busyKey === "accept-call"} type="button" onClick={onAccept}>
                Accept
              </Button>
              <Button busy={busyKey === "reject-call"} type="button" variant="danger" onClick={onReject}>
                Reject
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="secondary" onClick={onToggleAudio}>
                {audioMuted ? "Unmute" : "Mute"}
              </Button>
              {activeCall.kind === "video" ? (
                <Button type="button" variant="secondary" onClick={onToggleVideo}>
                  {videoMuted ? "Camera on" : "Camera off"}
                </Button>
              ) : null}
              <Button busy={busyKey === "end-call"} type="button" variant="danger" onClick={onEnd}>
                End
              </Button>
            </>
          )}
        </div>
      </div>
      {activeCall.kind === "video" ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <video ref={remoteVideoRef} className="aspect-video rounded-lg bg-black object-cover" autoPlay playsInline />
          <video ref={localVideoRef} className="aspect-video rounded-lg bg-black object-cover" autoPlay muted playsInline />
        </div>
      ) : null}
      <p className="mt-3 text-xs leading-5 text-[var(--color-muted)]">
        Calls use backend signaling only. Media connectivity depends on browser WebRTC and the network path available to both clients.
      </p>
    </div>
  );
}

function MemberActions({
  actor,
  chat,
  member,
  canManageMembers,
  canChangeRoles,
  busyKey,
  onRemove,
  onRoleChange,
}: {
  actor: ChatMember;
  chat: Chat;
  member: ChatMember;
  canManageMembers: boolean;
  canChangeRoles: boolean;
  busyKey: string | null;
  onRemove: () => void;
  onRoleChange: (role: Exclude<ConversationRole, "owner">) => void;
}) {
  if (!canManageMembers || member.role === "owner") {
    return null;
  }

  const removable = canRemoveMember(chat, actor, member);
  return (
    <div className="flex flex-col items-end gap-2">
      {canChangeRoles ? (
        <div className="flex gap-2">
          {member.role !== "admin" ? (
            <Button
              busy={busyKey === `role-${member.id}-admin`}
              type="button"
              variant="ghost"
              onClick={() => onRoleChange("admin")}
            >
              Promote
            </Button>
          ) : (
            <Button
              busy={busyKey === `role-${member.id}-member`}
              type="button"
              variant="ghost"
              onClick={() => onRoleChange("member")}
            >
              Demote
            </Button>
          )}
        </div>
      ) : null}
      {removable ? (
        <Button busy={busyKey === `remove-member-${member.id}`} type="button" variant="danger" onClick={onRemove}>
          Remove
        </Button>
      ) : null}
    </div>
  );
}

function matchesChat(chat: Chat, search: string, userId: number) {
  if (!search) {
    return true;
  }
  const haystack = [getChatTitle(chat, userId), getChatSubtitle(chat, userId), ...chat.members.map((member) => member.username)]
    .join(" ")
    .toLowerCase();
  return haystack.includes(search);
}

function matchesTopic(topic: Topic, search: string) {
  if (!search) {
    return true;
  }
  return `${topic.title} ${topic.description ?? ""}`.toLowerCase().includes(search);
}

function buildKnownUsers(chats: Chat[], currentUserId: number): KnownUser[] {
  const usersById = new Map<number, KnownUser>();
  for (const chat of chats) {
    const context = getChatTitle(chat, currentUserId);
    for (const member of chat.members) {
      if (member.id === currentUserId || usersById.has(member.id)) {
        continue;
      }
      usersById.set(member.id, {
        id: member.id,
        username: member.username,
        avatar_url: member.avatar_url,
        status: member.status,
        context,
      });
    }
  }
  return Array.from(usersById.values()).sort((left, right) => left.username.localeCompare(right.username));
}

function getChatTitle(chat: Chat, userId: number) {
  if (chat.kind !== "direct") {
    return chat.title || "Untitled conversation";
  }
  return chat.members.find((member) => member.id !== userId)?.username || "Direct chat";
}

function getChatSubtitle(chat: Chat, userId: number) {
  if (chat.kind === "direct") {
    const partner = chat.members.find((member) => member.id !== userId);
    return partner ? formatPresence(partner.status) : "Direct conversation";
  }
  return chat.description || `${chat.members.length} members`;
}

function parseNumericList(value: string) {
  return value
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isInteger(item) && item > 0);
}

function canManageMembersForChat(chat: Chat, member: ChatMember) {
  return chat.kind !== "direct" && hasModeratorRole(member);
}

function canManageTopicsForChat(chat: Chat, member: ChatMember) {
  return chat.kind === "supergroup" && hasModeratorRole(member);
}

function hasModeratorRole(member: ChatMember | null) {
  return member?.role === "owner" || member?.role === "admin";
}

function canManageMessage(chat: Chat, actor: ChatMember, message: Message) {
  if (actor.id === message.sender.id) {
    return true;
  }
  if (chat.kind === "direct") {
    return false;
  }
  return hasModeratorRole(actor);
}

function canRemoveMember(chat: Chat, actor: ChatMember, target: ChatMember) {
  if (!canManageMembersForChat(chat, actor)) {
    return false;
  }
  if (actor.id === target.id) {
    return true;
  }
  if (actor.role === "owner") {
    return true;
  }
  return actor.role === "admin" && target.role === "member";
}

function canSendMessageInScope(chat: Chat, member: ChatMember, topic: Topic | null) {
  if (chat.kind !== "supergroup") {
    return true;
  }
  if (!topic || topic.archived_at) {
    return false;
  }
  if (topic.is_closed) {
    return hasModeratorRole(member);
  }
  return true;
}

function isTerminalCall(call: Call) {
  return call.status === "rejected" || call.status === "canceled" || call.status === "ended";
}

function sessionDescriptionPayload(description: RTCSessionDescriptionInit): Record<string, unknown> {
  return {
    type: description.type,
    sdp: description.sdp,
  };
}

function formatBytes(value: number) {
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${Math.round(value / 1024)} KB`;
  }
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatPresence(status: PresenceStatus) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}
