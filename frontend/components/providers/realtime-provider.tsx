"use client";

import { createContext, useContext, useEffect, useState } from "react";

import type { RealtimeEvent } from "@/lib/api/contracts";
import { RealtimeConnectionManager, type RealtimeStatus } from "@/lib/realtime/connection-manager";
import { useAuth } from "@/components/providers/auth-provider";

type RealtimeContextValue = {
  status: RealtimeStatus;
  lastEvent: RealtimeEvent | null;
};

const RealtimeContext = createContext<RealtimeContextValue | null>(null);

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const { token, isAuthenticated } = useAuth();
  const [manager] = useState(() => new RealtimeConnectionManager(token));
  const [status, setStatus] = useState<RealtimeStatus>("idle");
  const [lastEvent, setLastEvent] = useState<RealtimeEvent | null>(null);

  useEffect(() => {
    const unsubscribeStatus = manager.subscribeToStatus(setStatus);
    const unsubscribeEvents = manager.subscribe(setLastEvent);
    return () => {
      unsubscribeStatus();
      unsubscribeEvents();
    };
  }, [manager]);

  useEffect(() => {
    if (isAuthenticated && token) {
      manager.updateToken(token);
      return;
    }

    manager.updateToken(null);
  }, [isAuthenticated, manager, token]);

  return <RealtimeContext.Provider value={{ status, lastEvent }}>{children}</RealtimeContext.Provider>;
}

export function useRealtime() {
  const context = useContext(RealtimeContext);
  if (!context) {
    throw new Error("useRealtime must be used within RealtimeProvider");
  }
  return context;
}
