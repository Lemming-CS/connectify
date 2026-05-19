import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils/cn";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "min-w-0 overflow-hidden rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)] shadow-[0_18px_48px_rgba(31,52,73,0.08)] backdrop-blur",
        className,
      )}
      {...props}
    />
  );
}
