import type { Call, CallCreateRequest, CallSignalRequest } from "@/lib/api/contracts";
import { apiRequest } from "@/lib/api/client";

export async function listCalls(token: string, chatId: number) {
  return apiRequest<Call[]>({
    path: `/chats/${chatId}/calls`,
    token,
  });
}

export async function startCall(token: string, chatId: number, payload: CallCreateRequest) {
  return apiRequest<Call>({
    path: `/chats/${chatId}/calls`,
    method: "POST",
    token,
    body: payload,
  });
}

export async function getCall(token: string, callId: number) {
  return apiRequest<Call>({
    path: `/calls/${callId}`,
    token,
  });
}

export async function acceptCall(token: string, callId: number) {
  return apiRequest<Call>({
    path: `/calls/${callId}/accept`,
    method: "POST",
    token,
  });
}

export async function rejectCall(token: string, callId: number) {
  return apiRequest<Call>({
    path: `/calls/${callId}/reject`,
    method: "POST",
    token,
  });
}

export async function endCall(token: string, callId: number) {
  return apiRequest<Call>({
    path: `/calls/${callId}/end`,
    method: "POST",
    token,
  });
}

export async function sendCallSignal(token: string, callId: number, payload: CallSignalRequest) {
  return apiRequest<{ accepted: boolean }>({
    path: `/calls/${callId}/signal`,
    method: "POST",
    token,
    body: payload,
  });
}
