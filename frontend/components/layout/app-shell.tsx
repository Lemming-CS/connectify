"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { useAuth } from "@/components/providers/auth-provider";
import { useNotifications } from "@/components/providers/notifications-provider";
import { useRealtime } from "@/components/providers/realtime-provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, StatusBadge } from "@/components/ui/panel";
import { cn } from "@/lib/utils/cn";

const NAV_ITEMS = [
  { href: "/chat", label: "Messenger", description: "Realtime chats, groups, and topics" },
  { href: "/settings", label: "Profile", description: "Identity, status, and preferences" },
];

const STATUS_COPY = {
  idle: "Offline",
  connecting: "Connecting",
  connected: "Live",
  disconnected: "Reconnecting",
} as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const { status } = useRealtime();
  const { notifications, unreadCount, isLoading, error, markRead, markAllRead, clearOne } = useNotifications();
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  return (
    <div className="min-h-screen bg-[var(--color-page)]">
      <div className="mx-auto grid min-h-screen max-w-[1440px] gap-6 px-4 py-4 lg:grid-cols-[320px_minmax(0,1fr)] lg:px-6 lg:py-6">
        <Card className="flex flex-col justify-between overflow-hidden bg-[linear-gradient(180deg,rgba(16,41,64,0.97),rgba(26,61,87,0.92))] p-5 text-white">
          <div className="space-y-6">
            <div className="space-y-3">
              <span className="inline-flex rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs uppercase tracking-[0.24em] text-white/80">
                Connectify
              </span>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">Messenger Workspace</h1>
                <p className="mt-2 text-sm leading-6 text-white/70">
                  Direct chats, group controls, topic switching, and realtime state now run on the shared app shell.
                </p>
              </div>
            </div>

            <div className="rounded-[24px] border border-white/10 bg-white/8 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">{user?.username ?? "Anonymous"}</p>
                  <p className="text-sm text-white/65">{user?.email}</p>
                </div>
                <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs text-white/80">
                  {STATUS_COPY[status]}
                </span>
              </div>
              <p className="mt-4 text-sm text-white/65">
                Profile status: <span className="font-semibold capitalize text-white">{user?.status ?? "offline"}</span>
              </p>
            </div>

            <div className="relative rounded-lg border border-white/10 bg-white/8 p-4">
              <button
                className="flex w-full items-center justify-between gap-3 text-left"
                type="button"
                aria-expanded={notificationsOpen}
                onClick={() => setNotificationsOpen((current) => !current)}
              >
                <span>
                  <span className="block text-sm font-semibold">Notifications</span>
                  <span className="mt-1 block text-sm text-white/65">
                    {unreadCount > 0 ? `${unreadCount} unread` : "All caught up"}
                  </span>
                </span>
                <span className="relative inline-flex rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs text-white/80">
                  Inbox
                  {unreadCount > 0 ? (
                    <span className="absolute -right-1 -top-2 min-w-5 rounded-full bg-[var(--color-accent)] px-1.5 py-0.5 text-center text-[10px] font-semibold text-white">
                      {unreadCount > 9 ? "9+" : unreadCount}
                    </span>
                  ) : null}
                </span>
              </button>

              {notificationsOpen ? (
                <div className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-20 max-h-[28rem] overflow-y-auto rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)] p-3 text-[var(--color-ink)] shadow-[0_18px_48px_rgba(31,52,73,0.18)]">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold">Notifications</p>
                    <button
                      className="text-xs font-semibold text-[var(--color-muted)] disabled:opacity-60"
                      disabled={unreadCount === 0}
                      type="button"
                      onClick={() => void markAllRead()}
                    >
                      Mark all read
                    </button>
                  </div>
                  {error ? <EmptyState>{error}</EmptyState> : null}
                  {isLoading && notifications.length === 0 ? <EmptyState>Loading notifications</EmptyState> : null}
                  {!isLoading && notifications.length === 0 ? <EmptyState>No notifications yet.</EmptyState> : null}
                  <div className="space-y-2">
                    {notifications.slice(0, 12).map((notification) => (
                      <div
                        key={notification.id}
                        className={cn(
                          "rounded-lg border px-3 py-3",
                          notification.is_read
                            ? "border-[var(--color-card-border)] bg-white/70"
                            : "border-[rgba(217,108,87,0.35)] bg-[rgba(217,108,87,0.08)]",
                        )}
                      >
                        <Link
                          className="block"
                          href={notificationLink(notification)}
                          onClick={() => {
                            if (!notification.is_read) {
                              void markRead(notification.id);
                            }
                            setNotificationsOpen(false);
                          }}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold">{notificationTitle(notification)}</p>
                              <p className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--color-muted)]">
                                {notificationDescription(notification)}
                              </p>
                            </div>
                            {!notification.is_read ? <StatusBadge>New</StatusBadge> : null}
                          </div>
                        </Link>
                        <div className="mt-2 flex gap-3">
                          {!notification.is_read ? (
                            <button
                              className="text-xs font-semibold text-[var(--color-muted)]"
                              type="button"
                              onClick={() => void markRead(notification.id)}
                            >
                              Mark read
                            </button>
                          ) : null}
                          <button
                            className="text-xs font-semibold text-[var(--color-muted)]"
                            type="button"
                            onClick={() => void clearOne(notification.id)}
                          >
                            Clear
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            <nav className="space-y-3">
              {NAV_ITEMS.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "block rounded-[24px] border px-4 py-4 transition",
                    pathname === item.href
                      ? "border-white/20 bg-white text-[var(--color-ink)] shadow-[0_18px_46px_rgba(10,24,36,0.25)]"
                      : "border-white/10 bg-white/6 text-white hover:bg-white/12",
                  )}
                >
                  <p className="text-sm font-semibold">{item.label}</p>
                  <p
                    className={cn(
                      "mt-1 text-sm leading-6",
                      pathname === item.href ? "text-[var(--color-muted)]" : "text-white/65",
                    )}
                  >
                    {item.description}
                  </p>
                </Link>
              ))}
            </nav>
          </div>

          <Button className="mt-6 w-full" variant="secondary" onClick={logout}>
            Log Out
          </Button>
        </Card>

        <div className="flex min-h-[80vh] flex-col">{children}</div>
      </div>
    </div>
  );
}

type ShellNotification = Parameters<typeof notificationTitle>[0];

function notificationTitle(notification: {
  kind: string;
  actor: { username: string } | null;
  data: Record<string, unknown>;
}) {
  const actor = notification.actor?.username ?? "Someone";
  if (notification.kind === "message_mention") {
    return `${actor} mentioned you`;
  }
  if (notification.kind === "message_new") {
    return `${actor} sent a message`;
  }
  if (notification.kind === "group_invite") {
    return `${actor} added you to a group`;
  }
  if (notification.kind === "group_role_changed") {
    return "Your group role changed";
  }
  if (notification.kind === "group_member_removed") {
    return "Group membership changed";
  }
  return "Notification";
}

function notificationDescription(notification: ShellNotification) {
  const preview = notification.data.message_preview;
  if (typeof preview === "string" && preview.trim()) {
    return preview;
  }
  const title = notification.data.conversation_title;
  if (typeof title === "string" && title.trim()) {
    return title;
  }
  return "Open the related conversation.";
}

function notificationLink(notification: {
  conversation_id: number | null;
  data: Record<string, unknown>;
}) {
  if (!notification.conversation_id) {
    return "/chat";
  }
  const params = new URLSearchParams({ chat: String(notification.conversation_id) });
  const topicId = notification.data.topic_id;
  if (typeof topicId === "number") {
    params.set("topic", String(topicId));
  }
  return `/chat?${params.toString()}`;
}
