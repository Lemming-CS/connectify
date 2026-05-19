"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import { useAuth } from "@/components/providers/auth-provider";
import { useRealtime } from "@/components/providers/realtime-provider";
import type { Notification } from "@/lib/api/contracts";
import {
  clearNotification,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/lib/api/notifications";

type NotificationsContextValue = {
  notifications: Notification[];
  unreadCount: number;
  isLoading: boolean;
  error: string | null;
  refreshNotifications: () => Promise<void>;
  markRead: (notificationId: number) => Promise<void>;
  markAllRead: () => Promise<void>;
  clearOne: (notificationId: number) => Promise<void>;
};

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { token, isAuthenticated } = useAuth();
  const { manager, status } = useRealtime();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refreshNotifications() {
    if (!token) {
      setNotifications([]);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const unread = await listNotifications(token, false);
      setNotifications(unread);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to load notifications.");
    } finally {
      setIsLoading(false);
    }
  }

  async function markRead(notificationId: number) {
    if (!token) {
      return;
    }
    const updated = await markNotificationRead(token, notificationId);
    setNotifications((current) => current.map((item) => (item.id === updated.id ? updated : item)));
  }

  async function markAllRead() {
    if (!token) {
      return;
    }
    const updated = await markAllNotificationsRead(token);
    const updatedById = new Map(updated.map((item) => [item.id, item]));
    setNotifications((current) => current.map((item) => updatedById.get(item.id) ?? { ...item, is_read: true }));
  }

  async function clearOne(notificationId: number) {
    if (!token) {
      return;
    }
    await clearNotification(token, notificationId);
    setNotifications((current) => current.filter((item) => item.id !== notificationId));
  }

  useEffect(() => {
    if (!isAuthenticated) {
      queueMicrotask(() => setNotifications([]));
      return;
    }
    queueMicrotask(() => void refreshNotifications());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, token]);

  useEffect(() => {
    const unsubscribe = manager.subscribe((event) => {
      if (event.type === "notification.created" && event.payload) {
        const notification = event.payload as unknown as Notification;
        setNotifications((current) => [
          notification,
          ...current.filter((item) => item.id !== notification.id),
        ]);
      }
      if (event.type === "notification.read" && event.payload) {
        const notification = event.payload as unknown as Notification;
        setNotifications((current) => current.map((item) => (item.id === notification.id ? notification : item)));
      }
      if (event.type === "notification.read_all") {
        setNotifications((current) => current.map((item) => ({ ...item, is_read: true })));
      }
      if (event.type === "notification.cleared" && event.payload?.notification_id) {
        setNotifications((current) => current.filter((item) => item.id !== Number(event.payload?.notification_id)));
      }
      if (event.type === "notification.cleared_all") {
        setNotifications([]);
      }
    });
    return unsubscribe;
  }, [manager]);

  useEffect(() => {
    if (status === "connected" && isAuthenticated) {
      queueMicrotask(() => void refreshNotifications());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  return (
    <NotificationsContext.Provider
      value={{
        notifications,
        unreadCount: notifications.filter((item) => !item.is_read).length,
        isLoading,
        error,
        refreshNotifications,
        markRead,
        markAllRead,
        clearOne,
      }}
    >
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications() {
  const context = useContext(NotificationsContext);
  if (!context) {
    throw new Error("useNotifications must be used within NotificationsProvider");
  }
  return context;
}
