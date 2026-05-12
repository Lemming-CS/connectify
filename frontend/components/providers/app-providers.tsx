"use client";

import { AuthProvider } from "@/components/providers/auth-provider";
import { RealtimeProvider } from "@/components/providers/realtime-provider";

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <RealtimeProvider>{children}</RealtimeProvider>
    </AuthProvider>
  );
}
