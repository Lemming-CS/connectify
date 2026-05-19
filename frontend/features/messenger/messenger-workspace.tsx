"use client";

import {
  useDeferredValue,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";

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
  Chat,
  ChatMember,
  ConversationRole,
  GroupCreateRequest,
  Message,
  PresenceStatus,
  Topic,
} from "@/lib/api/contracts";
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
      <MessengerWorkspaceInner />
    </MessengerProvider>
  );
}

function MessengerWorkspaceInner() {
  const { user } = useAuth();
  const { status } = useRealtime();
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
    };
  }, []);

  async function handleSendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = draft.trim();
    if (!body) {
      return;
    }
    setBusyKey("send-message");
    try {
      await sendTyping(false);
      await sendActiveMessage(body);
      setDraft("");
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
              emptyCopy="No known users yet. Open the developer fallback to use a user ID until user search exists."
              users={knownUsers}
              onSelect={(knownUser) => void handleCreateDirectFromKnownUser(knownUser)}
            />
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
              {activeChat.kind === "supergroup" && !activeTopic ? (
                <Banner className="mt-3">Select a topic to load supergroup messages.</Banner>
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
                    <div className="rounded-[28px] border border-dashed border-[var(--color-card-border)] bg-white/65 px-6 py-10 text-center">
                      <p className="text-sm font-semibold text-[var(--color-ink)]">No messages yet</p>
                      <p className="mt-2 text-sm text-[var(--color-muted)]">
                        Send the first message to start this conversation.
                      </p>
                    </div>
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
              <form className="space-y-3" onSubmit={handleSendMessage}>
                <Textarea
                  aria-label="Message body"
                  disabled={!canCompose}
                  placeholder={canCompose ? "Write a message" : "You cannot post in this chat right now"}
                  rows={3}
                  value={draft}
                  onChange={(event) => handleDraftChange(event.target.value)}
                />
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm text-[var(--color-muted)]">
                    {activeChat.kind === "supergroup"
                      ? "Messages stay isolated inside the selected topic."
                      : "Read state updates automatically when new messages arrive."}
                  </p>
                  <Button busy={busyKey === "send-message"} disabled={!canCompose || !draft.trim()} type="submit">
                    Send
                  </Button>
                </div>
              </form>
            </div>
          </>
        ) : (
          <div className="flex h-full min-h-[78vh] flex-col items-center justify-center px-8 text-center">
            <p className="text-xs uppercase tracking-[0.24em] text-[var(--color-muted)]">Messenger</p>
            <h2 className="mt-4 max-w-xl text-4xl font-semibold text-[var(--color-ink)]">Select a conversation or create a new one.</h2>
            <p className="mt-4 max-w-xl text-sm leading-7 text-[var(--color-muted)]">
              Search loaded chats, pick from known users, or use the developer fallback while backend user discovery is unavailable.
            </p>
          </div>
        )}
      </Card>

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
                  <div
                    key={attachment.id}
                    className={cn(
                      "rounded-2xl border px-3 py-2 text-sm",
                      isOwnMessage
                        ? "border-white/12 bg-white/10 text-white/88"
                        : "border-[var(--color-card-border)] bg-[var(--color-page)] text-[var(--color-ink)]",
                    )}
                  >
                    {attachment.original_filename || `${attachment.kind} attachment`}
                  </div>
                ))}
              </div>
            ) : null}
          </>
        )}
      </div>
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
