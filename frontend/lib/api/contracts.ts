export type PresenceStatus = "online" | "offline" | "away" | "busy";

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

export type RealtimeEvent = {
  type: string;
  conversation_id?: number;
  payload?: Record<string, unknown>;
};
