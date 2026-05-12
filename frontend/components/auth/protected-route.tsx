"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

import { Spinner } from "@/components/ui/spinner";
import { useAuth } from "@/components/providers/auth-provider";

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { status, isAuthenticated } = useAuth();

  useEffect(() => {
    if (status === "unauthenticated" || (status !== "booting" && !isAuthenticated)) {
      router.replace(`/login?next=${encodeURIComponent(pathname || "/chat")}`);
    }
  }, [isAuthenticated, pathname, router, status]);

  if (status === "booting" || !isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--color-page)]">
        <div className="flex items-center gap-3 rounded-full border border-[var(--color-card-border)] bg-white/80 px-5 py-3 text-sm text-[var(--color-muted)] shadow-[0_18px_42px_rgba(31,52,73,0.08)]">
          <Spinner />
          Restoring your session
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
