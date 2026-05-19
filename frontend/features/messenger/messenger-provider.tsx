"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { useAuth } from "@/components/providers/auth-provider";
import { useRealtime } from "@/components/providers/realtime-provider";
import {
  addChatMember,
  archiveTopic,
  createDirectChat,
  createGroup,
  createTopic,
  deleteMessage,
  editMessage,
  listChats,
  listMessages,
  listTopics,
  markChatRead,
  publishTyping,
  removeChatMember,
  sendMessage,
  updateChatMemberRole,
  uploadAttachment,
} from "@/lib/api/messaging";
import { ApiError } from "@/lib/api/client";
import type {
  Chat,
  ConversationRole,
  GroupCreateRequest,
  Message,
  ReadReceipt,
  RealtimeEvent,
  Topic,
  TopicCreateRequest,
} from "@/lib/api/contracts";

type ScopeState = {
  ids: number[];
  nextBeforeId: number | null;
  initialized: boolean;
  isLoading: boolean;
  isLoadingMore: boolean;
  error: string | null;
};

type TypingState = {
  user_id: number;
  username: string;
  expires_at: number;
};

type UploadState = {
  fileName: string;
  progress: number;
  error: string | null;
  isUploading: boolean;
};

type MessengerState = {
  chatIds: number[];
  chatsById: Record<number, Chat>;
  topicsByChatId: Record<number, Topic[]>;
  messagesById: Record<number, Message>;
  scopesByKey: Record<string, ScopeState>;
  typingByChatId: Record<number, TypingState[]>;
  upload: UploadState | null;
  selectedChatId: number | null;
  selectedTopicId: number | null;
  chatListLoaded: boolean;
  chatListLoading: boolean;
  error: string | null;
};

type MessengerContextValue = {
  state: MessengerState;
  activeChat: Chat | null;
  activeTopic: Topic | null;
  activeMessages: Message[];
  activeScope: ScopeState;
  clearError: () => void;
  selectChat: (chatId: number | null) => void;
  selectTopic: (topicId: number | null) => void;
  refreshChats: (force?: boolean) => Promise<void>;
  loadActiveMessages: (force?: boolean) => Promise<void>;
  loadOlderMessages: () => Promise<void>;
  sendActiveMessage: (body: string) => Promise<void>;
  editChatMessage: (messageId: number, body: string) => Promise<void>;
  deleteChatMessage: (messageId: number) => Promise<void>;
  markActiveRead: (messageId?: number | null) => Promise<void>;
  publishTypingState: (isTyping: boolean) => Promise<void>;
  uploadActiveAttachment: (payload: { file: File; body?: string | null; isVoiceMessage?: boolean }) => Promise<void>;
  createDirectConversation: (participantId: number) => Promise<void>;
  createGroupConversation: (kind: "group" | "supergroup", payload: GroupCreateRequest) => Promise<void>;
  addMemberToActiveChat: (userId: number) => Promise<void>;
  removeMemberFromActiveChat: (userId: number) => Promise<void>;
  updateMemberRoleInActiveChat: (userId: number, role: Exclude<ConversationRole, "owner">) => Promise<void>;
  loadTopicsForChat: (chatId: number, force?: boolean) => Promise<Topic[]>;
  createTopicInActiveChat: (payload: TopicCreateRequest) => Promise<void>;
  archiveTopicInActiveChat: (topicId: number) => Promise<void>;
};

const EMPTY_SCOPE: ScopeState = {
  ids: [],
  nextBeforeId: null,
  initialized: false,
  isLoading: false,
  isLoadingMore: false,
  error: null,
};

const MessengerContext = createContext<MessengerContextValue | null>(null);

function scopeKey(chatId: number, topicId: number | null) {
  return `${chatId}:${topicId ?? "root"}`;
}

function compareChats(a: Chat, b: Chat) {
  const aSort = a.last_message_at ?? a.updated_at;
  const bSort = b.last_message_at ?? b.updated_at;
  return new Date(bSort).getTime() - new Date(aSort).getTime();
}

function sortChatIds(chatsById: Record<number, Chat>) {
  return Object.values(chatsById)
    .sort(compareChats)
    .map((chat) => chat.id);
}

function upsertChatState(chatsById: Record<number, Chat>, chat: Chat) {
  const next = {
    ...chatsById,
    [chat.id]: chat,
  };
  return {
    chatsById: next,
    chatIds: sortChatIds(next),
  };
}

function upsertMessageIds(ids: number[], messageId: number) {
  if (ids.includes(messageId)) {
    return ids;
  }
  return [...ids, messageId].sort((left, right) => left - right);
}

function isMessageEvent(type: string) {
  return type === "message.created" || type === "message.updated" || type === "message.deleted";
}

function isGroupNotification(kind: unknown) {
  return kind === "group_invite" || kind === "group_member_removed" || kind === "group_role_changed";
}

function getErrorMessage(error: unknown) {
  if (error instanceof ApiError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Something went wrong. Please try again.";
}

export function MessengerProvider({ children }: { children: ReactNode }) {
  const { token, user } = useAuth();
  const { status, manager } = useRealtime();
  const [state, setState] = useState<MessengerState>({
    chatIds: [],
    chatsById: {},
    topicsByChatId: {},
    messagesById: {},
    scopesByKey: {},
    typingByChatId: {},
    upload: null,
    selectedChatId: null,
    selectedTopicId: null,
    chatListLoaded: false,
    chatListLoading: false,
    error: null,
  });

  const reconnectStatusRef = useRef(status);
  const lastReadRequestRef = useRef<Record<string, number>>({});

  const activeChat = state.selectedChatId ? state.chatsById[state.selectedChatId] ?? null : null;
  const activeTopics = activeChat ? state.topicsByChatId[activeChat.id] ?? [] : [];
  const activeTopic =
    activeChat?.kind === "supergroup"
      ? activeTopics.find((topic) => topic.id === state.selectedTopicId) ?? null
      : null;
  const activeScopeKey =
    activeChat == null || (activeChat.kind === "supergroup" && activeTopic == null)
      ? null
      : scopeKey(activeChat.id, activeTopic?.id ?? null);
  const activeScope = activeScopeKey ? state.scopesByKey[activeScopeKey] ?? EMPTY_SCOPE : EMPTY_SCOPE;
  const activeMessages = activeScope.ids.map((messageId) => state.messagesById[messageId]).filter(Boolean);

  async function refreshChats(force = false) {
    if (!token) {
      return;
    }
    if (!force && (state.chatListLoading || state.chatListLoaded)) {
      return;
    }

    setState((current) => ({
      ...current,
      chatListLoading: true,
      error: null,
    }));

    try {
      const chats = await listChats(token);
      setState((current) => {
        const chatsById = chats.reduce<Record<number, Chat>>((accumulator, chat) => {
          accumulator[chat.id] = chat;
          return accumulator;
        }, {});
        const selectedChatStillExists =
          current.selectedChatId != null && chatsById[current.selectedChatId] != null
            ? current.selectedChatId
            : chats[0]?.id ?? null;
        const selectedTopicId =
          selectedChatStillExists != null && chatsById[selectedChatStillExists]?.kind === "supergroup"
            ? current.selectedTopicId
            : null;

        return {
          ...current,
          chatsById,
          chatIds: chats.map((chat) => chat.id),
          chatListLoaded: true,
          chatListLoading: false,
          selectedChatId: selectedChatStillExists,
          selectedTopicId,
          error: null,
        };
      });
    } catch (error) {
      setState((current) => ({
        ...current,
        chatListLoading: false,
        error: getErrorMessage(error),
      }));
    }
  }

  async function loadTopicsForChat(chatId: number, force = false) {
    if (!token) {
      return [];
    }
    if (!force && state.topicsByChatId[chatId]) {
      return state.topicsByChatId[chatId];
    }

    try {
      const topics = await listTopics(token, chatId);
      setState((current) => ({
        ...current,
        topicsByChatId: {
          ...current.topicsByChatId,
          [chatId]: topics,
        },
      }));
      return topics;
    } catch (error) {
      setState((current) => ({
        ...current,
        error: getErrorMessage(error),
      }));
      return [];
    }
  }

  async function loadScopeMessages(chatId: number, topicId: number | null, options?: { force?: boolean; beforeId?: number | null }) {
    if (!token) {
      return;
    }
    const key = scopeKey(chatId, topicId);
    const existing = state.scopesByKey[key] ?? EMPTY_SCOPE;
    const beforeId = options?.beforeId ?? null;
    const isLoadingMore = beforeId != null;

    if (!options?.force && !isLoadingMore && existing.initialized) {
      return;
    }
    if (existing.isLoading || existing.isLoadingMore) {
      return;
    }

    setState((current) => ({
      ...current,
      scopesByKey: {
        ...current.scopesByKey,
        [key]: {
          ...(current.scopesByKey[key] ?? EMPTY_SCOPE),
          isLoading: !isLoadingMore,
          isLoadingMore,
          error: null,
        },
      },
    }));

    try {
      const page = await listMessages(token, chatId, {
        beforeId,
        limit: 30,
        topicId,
      });
      setState((current) => {
        const nextMessagesById = { ...current.messagesById };
        for (const message of page.items) {
          nextMessagesById[message.id] = message;
        }

        const currentScope = current.scopesByKey[key] ?? EMPTY_SCOPE;
        const pageIds = page.items.map((message) => message.id);
        const ids = isLoadingMore
          ? [...pageIds, ...currentScope.ids.filter((messageId) => !pageIds.includes(messageId))]
          : pageIds;

        return {
          ...current,
          messagesById: nextMessagesById,
          scopesByKey: {
            ...current.scopesByKey,
            [key]: {
              ids,
              nextBeforeId: page.next_before_id,
              initialized: true,
              isLoading: false,
              isLoadingMore: false,
              error: null,
            },
          },
        };
      });
    } catch (error) {
      setState((current) => ({
        ...current,
        scopesByKey: {
          ...current.scopesByKey,
          [key]: {
            ...(current.scopesByKey[key] ?? EMPTY_SCOPE),
            isLoading: false,
            isLoadingMore: false,
            error: getErrorMessage(error),
          },
        },
        error: getErrorMessage(error),
      }));
    }
  }

  async function loadActiveMessages(force = false) {
    if (!activeChat) {
      return;
    }
    if (activeChat.kind === "supergroup") {
      if (!activeTopic) {
        return;
      }
      await loadScopeMessages(activeChat.id, activeTopic.id, { force });
      return;
    }
    await loadScopeMessages(activeChat.id, null, { force });
  }

  async function loadOlderMessages() {
    if (!activeChat || !activeScope.nextBeforeId) {
      return;
    }
    await loadScopeMessages(activeChat.id, activeTopic?.id ?? null, {
      beforeId: activeScope.nextBeforeId,
    });
  }

  async function sendActiveMessage(body: string) {
    if (!token || !activeChat) {
      return;
    }
    const message = await sendMessage(token, activeChat.id, { body }, activeTopic?.id ?? null);
    setState((current) => applyMessageToState(current, message, current.chatsById[message.conversation_id]));
  }

  async function uploadActiveAttachment(payload: { file: File; body?: string | null; isVoiceMessage?: boolean }) {
    if (!token || !activeChat) {
      return;
    }
    setState((current) => ({
      ...current,
      upload: {
        fileName: payload.file.name,
        progress: 0,
        error: null,
        isUploading: true,
      },
    }));
    try {
      const message = await uploadAttachment(token, activeChat.id, {
        file: payload.file,
        body: payload.body,
        isVoiceMessage: payload.isVoiceMessage,
        topicId: activeTopic?.id ?? null,
        onProgress: (progress) => {
          setState((current) => ({
            ...current,
            upload: current.upload
              ? {
                  ...current.upload,
                  progress,
                }
              : current.upload,
          }));
        },
      });
      setState((current) => ({
        ...applyMessageToState(current, message, current.chatsById[message.conversation_id]),
        upload: null,
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        upload: {
          fileName: payload.file.name,
          progress: current.upload?.progress ?? 0,
          error: getErrorMessage(error),
          isUploading: false,
        },
      }));
      throw error;
    }
  }

  async function editChatMessage(messageId: number, body: string) {
    if (!token || !activeChat) {
      return;
    }
    const message = await editMessage(token, activeChat.id, messageId, { body });
    setState((current) => applyMessageToState(current, message, current.chatsById[message.conversation_id]));
  }

  async function deleteChatMessage(messageId: number) {
    if (!token || !activeChat) {
      return;
    }
    const message = await deleteMessage(token, activeChat.id, messageId);
    setState((current) => applyMessageToState(current, message, current.chatsById[message.conversation_id]));
  }

  async function markActiveRead(messageId?: number | null) {
    if (!token || !activeChat) {
      return;
    }
    const receipt = await markChatRead(token, activeChat.id, {
      message_id: messageId ?? null,
    });
    setState((current) => updateReceiptState(current, activeChat.id, receipt));
  }

  async function publishTypingState(isTyping: boolean) {
    if (!token || !activeChat) {
      return;
    }
    await publishTyping(token, activeChat.id, { is_typing: isTyping });
  }

  async function createDirectConversation(participantId: number) {
    if (!token) {
      return;
    }
    const chat = await createDirectChat(token, { participant_id: participantId });
    setState((current) => {
      const next = upsertChatState(current.chatsById, chat);
      return {
        ...current,
        ...next,
        selectedChatId: chat.id,
        selectedTopicId: null,
      };
    });
  }

  async function createGroupConversation(kind: "group" | "supergroup", payload: GroupCreateRequest) {
    if (!token) {
      return;
    }
    const chat = await createGroup(token, payload, kind);
    setState((current) => {
      const next = upsertChatState(current.chatsById, chat);
      return {
        ...current,
        ...next,
        selectedChatId: chat.id,
        selectedTopicId: null,
      };
    });
    if (kind === "supergroup") {
      await loadTopicsForChat(chat.id, true);
    }
  }

  async function addMemberToActiveChat(userId: number) {
    if (!token || !activeChat) {
      return;
    }
    const chat = await addChatMember(token, activeChat.id, { user_id: userId });
    setState((current) => {
      const next = upsertChatState(current.chatsById, chat);
      return {
        ...current,
        ...next,
      };
    });
  }

  async function removeMemberFromActiveChat(userId: number) {
    if (!token || !activeChat) {
      return;
    }
    const chat = await removeChatMember(token, activeChat.id, userId);
    setState((current) => {
      const next = upsertChatState(current.chatsById, chat);
      const selectedChatId = userId === user?.id && chat.members.every((member) => member.id !== user.id) ? null : current.selectedChatId;
      return {
        ...current,
        ...next,
        selectedChatId,
      };
    });
  }

  async function updateMemberRoleInActiveChat(userId: number, role: Exclude<ConversationRole, "owner">) {
    if (!token || !activeChat) {
      return;
    }
    const chat = await updateChatMemberRole(token, activeChat.id, userId, { role });
    setState((current) => {
      const next = upsertChatState(current.chatsById, chat);
      return {
        ...current,
        ...next,
      };
    });
  }

  async function createTopicInActiveChat(payload: TopicCreateRequest) {
    if (!token || !activeChat) {
      return;
    }
    const topic = await createTopic(token, activeChat.id, payload);
    setState((current) => ({
      ...current,
      topicsByChatId: {
        ...current.topicsByChatId,
        [activeChat.id]: [...(current.topicsByChatId[activeChat.id] ?? []), topic].sort((left, right) => left.id - right.id),
      },
      selectedTopicId: topic.id,
    }));
  }

  async function archiveTopicInActiveChat(topicId: number) {
    if (!token || !activeChat) {
      return;
    }
    const topic = await archiveTopic(token, activeChat.id, topicId);
    setState((current) => ({
      ...current,
      topicsByChatId: {
        ...current.topicsByChatId,
        [activeChat.id]: (current.topicsByChatId[activeChat.id] ?? []).map((item) => (item.id === topic.id ? topic : item)),
      },
      selectedTopicId: current.selectedTopicId === topic.id ? current.topicsByChatId[activeChat.id]?.find((item) => item.is_general)?.id ?? null : current.selectedTopicId,
    }));
  }

  function selectChat(chatId: number | null) {
    setState((current) => ({
      ...current,
      selectedChatId: chatId,
      selectedTopicId: chatId != null && current.chatsById[chatId]?.kind === "supergroup" ? current.selectedTopicId : null,
      error: null,
    }));
  }

  function selectTopic(topicId: number | null) {
    setState((current) => ({
      ...current,
      selectedTopicId: topicId,
      error: null,
    }));
  }

  function clearError() {
    setState((current) => ({
      ...current,
      error: null,
    }));
  }

  useEffect(() => {
    void refreshChats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (!activeChat) {
      return;
    }
    if (activeChat.kind !== "supergroup") {
      if (state.selectedTopicId != null) {
        setState((current) => ({
          ...current,
          selectedTopicId: null,
        }));
      }
      return;
    }

    let isActive = true;
    const activeChatId = activeChat.id;
    async function ensureTopics() {
      const topics = await loadTopicsForChat(activeChatId);
      if (!isActive) {
        return;
      }
      if (topics.length === 0) {
        return;
      }
      const selectedTopicExists = topics.some((topic) => topic.id === state.selectedTopicId);
      if (!selectedTopicExists) {
        const generalTopic = topics.find((topic) => topic.is_general) ?? topics[0];
        setState((current) => ({
          ...current,
          selectedTopicId: generalTopic?.id ?? null,
        }));
      }
    }

    void ensureTopics();
    return () => {
      isActive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChat, state.selectedTopicId]);

  useEffect(() => {
    void loadActiveMessages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChat?.id, activeTopic?.id]);

  useEffect(() => {
    const unsubscribe = manager.subscribe((event) => {
      setState((current) => applyRealtimeEvent(current, event));
      if (event.type === "notification.created" && isGroupNotification(event.payload?.kind)) {
        void refreshChats(true);
      }
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manager, token]);

  useEffect(() => {
    if (reconnectStatusRef.current === "disconnected" && status === "connected") {
      void refreshChats(true);
      void loadActiveMessages(true);
      if (activeChat?.kind === "supergroup") {
        void loadTopicsForChat(activeChat.id, true);
      }
    }
    reconnectStatusRef.current = status;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChat, loadActiveMessages, status]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setState((current) => ({
        ...current,
        typingByChatId: Object.fromEntries(
          Object.entries(current.typingByChatId)
            .map(([chatId, entries]) => [
              chatId,
              entries.filter((entry) => entry.expires_at > Date.now()),
            ])
            .filter(([, entries]) => entries.length > 0),
        ),
      }));
    }, 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!user || !activeChat || activeMessages.length === 0) {
      return;
    }
    const latest = activeMessages[activeMessages.length - 1];
    if (!latest || latest.sender.id === user.id) {
      return;
    }
    const key = scopeKey(activeChat.id, activeTopic?.id ?? null);
    const requestedMessageId = lastReadRequestRef.current[key] ?? 0;
    const currentReceipt = activeChat.read_states.find((receipt) => receipt.user_id === user.id)?.last_read_message_id ?? 0;
    if (latest.id <= Math.max(requestedMessageId, currentReceipt)) {
      return;
    }

    lastReadRequestRef.current[key] = latest.id;
    void markActiveRead(latest.id).catch(() => {
      delete lastReadRequestRef.current[key];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChat, activeMessages, activeTopic, user]);

  return (
    <MessengerContext.Provider
      value={{
        state,
        activeChat,
        activeTopic,
        activeMessages,
        activeScope,
        clearError,
        selectChat,
        selectTopic,
        refreshChats,
        loadActiveMessages,
        loadOlderMessages,
        sendActiveMessage,
        editChatMessage,
        deleteChatMessage,
        markActiveRead,
        publishTypingState,
        uploadActiveAttachment,
        createDirectConversation,
        createGroupConversation,
        addMemberToActiveChat,
        removeMemberFromActiveChat,
        updateMemberRoleInActiveChat,
        loadTopicsForChat,
        createTopicInActiveChat,
        archiveTopicInActiveChat,
      }}
    >
      {children}
    </MessengerContext.Provider>
  );
}

function applyMessageToState(state: MessengerState, message: Message, existingChat?: Chat) {
  const key = scopeKey(message.conversation_id, message.topic_id ?? null);
  const scope = state.scopesByKey[key] ?? EMPTY_SCOPE;
  const chat = existingChat
    ? {
        ...existingChat,
        last_message_at: message.created_at,
      }
    : existingChat;
  const nextChats = chat ? upsertChatState(state.chatsById, chat) : { chatsById: state.chatsById, chatIds: state.chatIds };

  return {
    ...state,
    ...nextChats,
    messagesById: {
      ...state.messagesById,
      [message.id]: message,
    },
    scopesByKey: {
      ...state.scopesByKey,
      [key]: {
        ...scope,
        initialized: scope.initialized || state.selectedChatId === message.conversation_id,
        ids: upsertMessageIds(scope.ids, message.id),
      },
    },
  };
}

function updateReceiptState(state: MessengerState, conversationId: number, receipt: ReadReceipt) {
  const chat = state.chatsById[conversationId];
  if (!chat) {
    return state;
  }

  const existingIndex = chat.read_states.findIndex((item) => item.user_id === receipt.user_id);
  const nextReadStates = [...chat.read_states];
  if (existingIndex >= 0) {
    nextReadStates[existingIndex] = receipt;
  } else {
    nextReadStates.push(receipt);
  }

  const nextChat = {
    ...chat,
    read_states: nextReadStates,
  };
  const next = upsertChatState(state.chatsById, nextChat);
  return {
    ...state,
    ...next,
  };
}

function applyRealtimeEvent(state: MessengerState, event: RealtimeEvent) {
  if (event.conversation_id == null) {
    return state;
  }

  if (isMessageEvent(event.type) && event.payload) {
    const message = event.payload as unknown as Message;
    return applyMessageToState(state, message, state.chatsById[message.conversation_id]);
  }

  if (event.type === "message.read" && event.payload) {
    return updateReceiptState(state, event.conversation_id, event.payload as unknown as ReadReceipt);
  }

  if (event.type === "typing" && event.payload) {
    const userId = Number(event.payload.user_id);
    const username = String(event.payload.username ?? "");
    const isTyping = Boolean(event.payload.is_typing);
    const nextEntries = (state.typingByChatId[event.conversation_id] ?? []).filter((entry) => entry.user_id !== userId);
    return {
      ...state,
      typingByChatId: {
        ...state.typingByChatId,
        [event.conversation_id]: isTyping
          ? [
              ...nextEntries,
              {
                user_id: userId,
                username,
                expires_at: Date.now() + 4000,
              },
            ]
          : nextEntries,
      },
    };
  }

  return state;
}

export function useMessenger() {
  const context = useContext(MessengerContext);
  if (!context) {
    throw new Error("useMessenger must be used within MessengerProvider");
  }
  return context;
}
