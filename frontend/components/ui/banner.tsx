import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils/cn";

type BannerProps = HTMLAttributes<HTMLDivElement> & {
  tone?: "info" | "danger" | "success";
};

export function Banner({ className, tone = "info", ...props }: BannerProps) {
  return (
    <div
      className={cn(
        "rounded-2xl border px-4 py-3 text-sm",
        tone === "info" && "border-[rgba(16,41,64,0.12)] bg-[rgba(16,41,64,0.06)] text-[var(--color-ink)]",
        tone === "danger" && "border-[rgba(199,88,80,0.18)] bg-[rgba(199,88,80,0.08)] text-[var(--color-danger)]",
        tone === "success" && "border-[rgba(53,117,93,0.18)] bg-[rgba(53,117,93,0.08)] text-[var(--color-success)]",
        className,
      )}
      {...props}
    />
  );
}
