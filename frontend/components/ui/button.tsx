"use client";

import type { ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/utils/cn";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  busy?: boolean;
};

export function Button({
  className,
  children,
  variant = "primary",
  busy = false,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex min-h-11 items-center justify-center rounded-2xl px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60",
        variant === "primary" && "bg-[var(--color-ink)] text-white shadow-[0_12px_30px_rgba(16,41,64,0.2)] hover:bg-[var(--color-ink-strong)]",
        variant === "secondary" && "bg-[var(--color-card-strong)] text-[var(--color-ink)] hover:bg-[var(--color-card-border)]",
        variant === "ghost" && "bg-transparent text-[var(--color-ink)] hover:bg-[var(--color-card)]",
        variant === "danger" && "bg-[var(--color-danger)] text-white hover:bg-[#bf4a44]",
        className,
      )}
      disabled={disabled || busy}
      {...props}
    >
      {busy ? "Please wait..." : children}
    </button>
  );
}
