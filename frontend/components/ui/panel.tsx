import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

export function Panel({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <section
      className={cn(
        "min-w-0 rounded-lg border border-[var(--color-card-border)] bg-white/72",
        className,
      )}
      {...props}
    />
  );
}

export function PanelHeader({
  eyebrow,
  title,
  description,
  action,
  className,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-wrap items-start justify-between gap-3", className)}>
      <div className="min-w-0">
        {eyebrow ? (
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-muted)]">{eyebrow}</p>
        ) : null}
        <h2 className="mt-1 text-xl font-semibold text-[var(--color-ink)]">{title}</h2>
        {description ? <p className="mt-1 text-sm leading-6 text-[var(--color-muted)]">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function EmptyState({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-lg border border-dashed border-[var(--color-card-border)] px-4 py-4 text-sm text-[var(--color-muted)]",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function StatusBadge({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center rounded-full border border-[var(--color-card-border)] bg-white/80 px-2.5 py-1 text-xs font-semibold text-[var(--color-muted)]",
        className,
      )}
      {...props}
    />
  );
}
