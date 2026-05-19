import type {
  Chat,
  DirectChatCreateRequest,
  GroupCreateRequest,
  MemberAddRequest,
  MemberRoleUpdateRequest,
  Message,
  MessageCreateRequest,
  MessagePage,
  MessageUpdateRequest,
  ReadReceipt,
  ReadStatusUpdateRequest,
  Topic,
  TopicCreateRequest,
  TypingIndicatorUpdateRequest,
} from "@/lib/api/contracts";
import { apiRequest } from "@/lib/api/client";

export async function listChats(token: string) {
  return apiRequest<Chat[]>({
    path: "/chats",
    token,
  });
}

export async function createDirectChat(token: string, payload: DirectChatCreateRequest) {
  return apiRequest<Chat>({
    path: "/chats/direct",
    method: "POST",
    token,
    body: payload,
  });
}

export async function createGroup(token: string, payload: GroupCreateRequest, kind: "group" | "supergroup") {
  return apiRequest<Chat>({
    path: `/chats/${kind}`,
    method: "POST",
    token,
    body: payload,
  });
}

export async function addChatMember(token: string, chatId: number, payload: MemberAddRequest) {
  return apiRequest<Chat>({
    path: `/chats/${chatId}/members`,
    method: "POST",
    token,
    body: payload,
  });
}

export async function removeChatMember(token: string, chatId: number, userId: number) {
  return apiRequest<Chat>({
    path: `/chats/${chatId}/members/${userId}`,
    method: "DELETE",
    token,
  });
}

export async function updateChatMemberRole(
  token: string,
  chatId: number,
  userId: number,
  payload: MemberRoleUpdateRequest,
) {
  return apiRequest<Chat>({
    path: `/chats/${chatId}/members/${userId}`,
    method: "PATCH",
    token,
    body: payload,
  });
}

export async function listMessages(
  token: string,
  chatId: number,
  options?: {
    beforeId?: number | null;
    limit?: number;
    topicId?: number | null;
  },
) {
  const params = new URLSearchParams();
  if (options?.beforeId) {
    params.set("before_id", String(options.beforeId));
  }
  if (options?.limit) {
    params.set("limit", String(options.limit));
  }

  const basePath =
    options?.topicId != null ? `/chats/${chatId}/topics/${options.topicId}/messages` : `/chats/${chatId}/messages`;
  return apiRequest<MessagePage>({
    path: params.size > 0 ? `${basePath}?${params.toString()}` : basePath,
    token,
  });
}

export async function sendMessage(
  token: string,
  chatId: number,
  payload: MessageCreateRequest,
  topicId?: number | null,
) {
  const path = topicId != null ? `/chats/${chatId}/topics/${topicId}/messages` : `/chats/${chatId}/messages`;
  return apiRequest<Message>({
    path,
    method: "POST",
    token,
    body: payload,
  });
}

export async function editMessage(token: string, chatId: number, messageId: number, payload: MessageUpdateRequest) {
  return apiRequest<Message>({
    path: `/chats/${chatId}/messages/${messageId}`,
    method: "PATCH",
    token,
    body: payload,
  });
}

export async function deleteMessage(token: string, chatId: number, messageId: number) {
  return apiRequest<Message>({
    path: `/chats/${chatId}/messages/${messageId}`,
    method: "DELETE",
    token,
  });
}

export async function markChatRead(token: string, chatId: number, payload: ReadStatusUpdateRequest) {
  return apiRequest<ReadReceipt>({
    path: `/chats/${chatId}/read`,
    method: "POST",
    token,
    body: payload,
  });
}

export async function publishTyping(token: string, chatId: number, payload: TypingIndicatorUpdateRequest) {
  return apiRequest<{ accepted: boolean }>({
    path: `/chats/${chatId}/typing`,
    method: "POST",
    token,
    body: payload,
  });
}

export async function listTopics(token: string, chatId: number) {
  return apiRequest<Topic[]>({
    path: `/chats/${chatId}/topics`,
    token,
  });
}

export async function createTopic(token: string, chatId: number, payload: TopicCreateRequest) {
  return apiRequest<Topic>({
    path: `/chats/${chatId}/topics`,
    method: "POST",
    token,
    body: payload,
  });
}

export async function archiveTopic(token: string, chatId: number, topicId: number) {
  return apiRequest<Topic>({
    path: `/chats/${chatId}/topics/${topicId}/archive`,
    method: "POST",
    token,
  });
}
