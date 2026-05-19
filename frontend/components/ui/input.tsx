import type { InputHTMLAttributes } from "react";

import { cn } from "@/lib/utils/cn";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "min-h-12 w-full min-w-0 rounded-lg border border-[var(--color-card-border)] bg-white/80 px-4 text-sm text-[var(--color-ink)] outline-none transition placeholder:text-[var(--color-muted)] focus:border-[var(--color-accent)] focus:ring-4 focus:ring-[rgba(217,108,87,0.12)] disabled:bg-[var(--color-card-strong)] disabled:text-[var(--color-muted)]",
        className,
      )}
      {...props}
    />
  );
}
