import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils/cn";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-[28px] border border-[var(--color-card-border)] bg-[var(--color-card)] shadow-[0_24px_60px_rgba(31,52,73,0.08)] backdrop-blur",
        className,
      )}
      {...props}
    />
  );
}
