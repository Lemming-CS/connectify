export type PresenceStatus = "online" | "offline" | "away" | "busy";
export type ConversationKind = "direct" | "group" | "supergroup";
export type ConversationRole = "owner" | "admin" | "member";
export type CallKind = "audio" | "video";

export type ApiErrorPayload = {
  detail?: string;
};

export type AuthToken = {
  access_token: string;
  token_type: string;
};

export type User = {
  id: number;
  email: string;
  username: string;
  avatar_url: string | null;
  description: string | null;
  status: PresenceStatus;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type LoginRequest = {
  email: string;
  password: string;
};

export type RegisterRequest = {
  email: string;
  username: string;
  password: string;
};

export type UserProfileUpdateRequest = {
  avatar_url?: string | null;
  description?: string | null;
  status?: PresenceStatus | null;
};

export type ChatMember = {
  id: number;
  username: string;
  avatar_url: string | null;
  status: PresenceStatus;
  role: ConversationRole;
};

export type ReadReceipt = {
  user_id: number;
  username: string;
  last_read_message_id: number | null;
  last_read_at: string | null;
};

export type Attachment = {
  id: number;
  kind: string;
  is_voice_message: boolean;
  original_filename: string | null;
  content_type: string | null;
  size_bytes: number;
  checksum_sha256: string | null;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  created_at: string;
  media_url: string;
};

export type MessageSender = {
  id: number;
  username: string;
  avatar_url: string | null;
};

export type Message = {
  id: number;
  conversation_id: number;
  topic_id: number | null;
  sender: MessageSender;
  body: string | null;
  attachments: Attachment[];
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
};

export type MessagePage = {
  items: Message[];
  next_before_id: number | null;
};

export type Topic = {
  id: number;
  conversation_id: number;
  title: string;
  description: string | null;
  is_general: boolean;
  is_closed: boolean;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export type Chat = {
  id: number;
  kind: ConversationKind;
  title: string | null;
  description: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
  last_message_at: string | null;
  members: ChatMember[];
  read_states: ReadReceipt[];
};

export type DirectChatCreateRequest = {
  participant_id: number;
};

export type GroupCreateRequest = {
  title: string;
  description?: string | null;
  avatar_url?: string | null;
  member_ids: number[];
};

export type TopicCreateRequest = {
  title: string;
  description?: string | null;
};

export type MessageCreateRequest = {
  body: string;
};

export type MessageUpdateRequest = {
  body: string;
};

export type MemberAddRequest = {
  user_id: number;
};

export type MemberRoleUpdateRequest = {
  role: Exclude<ConversationRole, "owner">;
};

export type TypingIndicatorUpdateRequest = {
  is_typing: boolean;
};

export type ReadStatusUpdateRequest = {
  message_id?: number | null;
};

export type NotificationActor = {
  id: number;
  username: string;
  avatar_url: string | null;
};

export type Notification = {
  id: number;
  kind: string;
  recipient_id: number;
  conversation_id: number | null;
  message_id: number | null;
  actor: NotificationActor | null;
  data: Record<string, unknown>;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
};

export type NotificationClearResult = {
  cleared_count: number;
};

export type CallUser = {
  id: number;
  username: string;
  avatar_url: string | null;
};

export type CallStatus = "ringing" | "active" | "rejected" | "canceled" | "ended";

export type Call = {
  id: number;
  conversation_id: number;
  caller: CallUser;
  callee: CallUser;
  ended_by_id: number | null;
  kind: CallKind;
  status: CallStatus;
  metadata: Record<string, unknown>;
  created_at: string;
  accepted_at: string | null;
  ended_at: string | null;
};

export type CallCreateRequest = {
  kind: CallKind;
};

export type CallSignalType = "offer" | "answer" | "ice_candidate";

export type CallSignalRequest = {
  signal_type: CallSignalType;
  payload: Record<string, unknown>;
};

export type RealtimeEvent = {
  type: string;
  conversation_id?: number;
  payload?: Record<string, unknown>;
};
