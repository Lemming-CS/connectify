import type { Notification, NotificationClearResult } from "@/lib/api/contracts";
import { apiRequest } from "@/lib/api/client";

export async function listNotifications(token: string, unreadOnly = true) {
  return apiRequest<Notification[]>({
    path: `/notifications?unread_only=${String(unreadOnly)}`,
    token,
  });
}

export async function markNotificationRead(token: string, notificationId: number) {
  return apiRequest<Notification>({
    path: `/notifications/${notificationId}/read`,
    method: "POST",
    token,
  });
}

export async function markAllNotificationsRead(token: string) {
  return apiRequest<Notification[]>({
    path: "/notifications/read-all",
    method: "POST",
    token,
  });
}

export async function clearNotification(token: string, notificationId: number) {
  return apiRequest<NotificationClearResult>({
    path: `/notifications/${notificationId}`,
    method: "DELETE",
    token,
  });
}
