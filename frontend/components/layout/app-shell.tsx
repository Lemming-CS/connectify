"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { useAuth } from "@/components/providers/auth-provider";
import { useRealtime } from "@/components/providers/realtime-provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
