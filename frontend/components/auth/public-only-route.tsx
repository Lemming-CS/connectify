"use client";

import { useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";

import { Spinner } from "@/components/ui/spinner";
import { useAuth } from "@/components/providers/auth-provider";

export function PublicOnlyRoute({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { status, isAuthenticated } = useAuth();

  useEffect(() => {
    if (status === "authenticated" && isAuthenticated) {
      router.replace(searchParams.get("next") || "/chat");
    }
  }, [isAuthenticated, router, searchParams, status]);

  if (status === "booting") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--color-page)]">
        <div className="flex items-center gap-3 rounded-full border border-[var(--color-card-border)] bg-white/80 px-5 py-3 text-sm text-[var(--color-muted)] shadow-[0_18px_42px_rgba(31,52,73,0.08)]">
          <Spinner />
          Checking your session
        </div>
      </div>
    );
  }

  if (status === "authenticated" && isAuthenticated) {
    return null;
  }

  return <>{children}</>;
}
