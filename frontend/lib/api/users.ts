import type { User, UserProfileUpdateRequest } from "@/lib/api/contracts";
import { apiRequest } from "@/lib/api/client";

export async function fetchCurrentUser(token: string) {
  return apiRequest<User>({
    path: "/users/me",
    token,
  });
}

export async function updateCurrentUser(token: string, payload: UserProfileUpdateRequest) {
  return apiRequest<User>({
    path: "/users/me",
    method: "PATCH",
    token,
    body: payload,
  });
}
