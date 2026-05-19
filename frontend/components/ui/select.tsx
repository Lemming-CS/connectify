import type { SelectHTMLAttributes } from "react";

import { cn } from "@/lib/utils/cn";

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "min-h-12 w-full min-w-0 rounded-lg border border-[var(--color-card-border)] bg-white/80 px-4 text-sm text-[var(--color-ink)] outline-none transition focus:border-[var(--color-accent)] focus:ring-4 focus:ring-[rgba(217,108,87,0.12)]",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}
