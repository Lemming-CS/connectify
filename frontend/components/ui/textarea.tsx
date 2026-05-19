import type { TextareaHTMLAttributes } from "react";

import { cn } from "@/lib/utils/cn";

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "min-h-32 w-full min-w-0 resize-y rounded-lg border border-[var(--color-card-border)] bg-white/80 px-4 py-3 text-sm text-[var(--color-ink)] outline-none transition placeholder:text-[var(--color-muted)] focus:border-[var(--color-accent)] focus:ring-4 focus:ring-[rgba(217,108,87,0.12)] disabled:bg-[var(--color-card-strong)] disabled:text-[var(--color-muted)]",
        className,
      )}
      {...props}
    />
  );
}
