import type { AuthToken, LoginRequest, RegisterRequest, User } from "@/lib/api/contracts";
import { apiRequest } from "@/lib/api/client";

export async function registerUser(payload: RegisterRequest) {
  return apiRequest<User>({
    path: "/auth/register",
    method: "POST",
    body: payload,
  });
}

export async function loginUser(payload: LoginRequest) {
  return apiRequest<AuthToken>({
    path: "/auth/login",
    method: "POST",
    body: payload,
  });
}
