"use client";

import { useDeferredValue, useState } from "react";

import { EmptyState, StatusBadge } from "@/components/ui/panel";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils/cn";
import type { ChatMember } from "@/lib/api/contracts";

export type KnownUser = Pick<ChatMember, "id" | "username" | "avatar_url" | "status"> & {
  context: string;
};

type UserSelectorProps = {
  users: KnownUser[];
  selectedIds?: number[];
  actionLabel?: string;
  emptyCopy: string;
  mode?: "single" | "multiple";
  onSelect?: (user: KnownUser) => void;
  onToggle?: (user: KnownUser) => void;
};

export function UserSelector({
  users,
  selectedIds = [],
  actionLabel = "Select",
  emptyCopy,
  mode = "single",
  onSelect,
  onToggle,
}: UserSelectorProps) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());
  const filteredUsers = users.filter((user) =>
    `${user.username} ${user.context} ${user.status}`.toLowerCase().includes(deferredQuery),
  );

  return (
    <div className="min-w-0 space-y-3">
      <Input
        aria-label="Search known users"
        placeholder="Search known users"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {filteredUsers.length === 0 ? (
        <EmptyState>{emptyCopy}</EmptyState>
      ) : (
        <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
          {filteredUsers.map((user) => {
            const selected = selectedIds.includes(user.id);
            return (
              <button
                key={user.id}
                className={cn(
                  "flex w-full min-w-0 items-center justify-between gap-3 rounded-lg border px-3 py-3 text-left transition",
                  selected
                    ? "border-[var(--color-ink)] bg-[rgba(23,50,74,0.08)]"
                    : "border-[var(--color-card-border)] bg-white/78 hover:bg-white",
                )}
                type="button"
                onClick={() => {
                  if (mode === "multiple") {
                    onToggle?.(user);
                    return;
                  }
                  onSelect?.(user);
                }}
              >
                <span className="flex min-w-0 items-center gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--color-card-strong)] text-sm font-semibold text-[var(--color-ink)]">
                    {user.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img alt="" className="size-full object-cover" src={user.avatar_url} />
                    ) : (
                      user.username.slice(0, 1).toUpperCase()
                    )}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-[var(--color-ink)]">
                      {user.username}
                    </span>
                    <span className="block truncate text-xs text-[var(--color-muted)]">{user.context}</span>
                  </span>
                </span>
                <StatusBadge className="shrink-0">{mode === "multiple" ? (selected ? "Added" : "Add") : actionLabel}</StatusBadge>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
