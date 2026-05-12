import { Suspense } from "react";

import { PublicOnlyRoute } from "@/components/auth/public-only-route";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={null}>
      <PublicOnlyRoute>
        <div className="min-h-screen bg-[var(--color-page)] px-4 py-6 sm:px-6 sm:py-8">
          <div className="mx-auto grid min-h-[calc(100vh-3rem)] max-w-[1260px] gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(420px,560px)]">
            <section className="hidden rounded-[36px] bg-[linear-gradient(180deg,rgba(16,41,64,0.97),rgba(27,70,96,0.92))] p-10 text-white shadow-[0_28px_70px_rgba(16,41,64,0.16)] lg:flex lg:flex-col lg:justify-between">
              <div className="space-y-6">
                <span className="inline-flex rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs uppercase tracking-[0.26em] text-white/80">
                  Connectify
                </span>
                <div className="space-y-4">
                  <h1 className="max-w-md text-5xl font-semibold leading-[1.05] tracking-tight">
                    Real conversations need a calm, fast control surface.
                  </h1>
                  <p className="max-w-xl text-lg leading-8 text-white/72">
                    The foundation is built for messaging, groups, notifications, and signaling without trapping the
                    frontend in one-off state management.
                  </p>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-[28px] border border-white/10 bg-white/8 p-5">
                  <p className="text-sm font-semibold">Typed API layer</p>
                  <p className="mt-2 text-sm leading-6 text-white/68">
                    Auth, current-user fetching, profile updates, and realtime hooks all share a single client boundary.
                  </p>
                </div>
                <div className="rounded-[28px] border border-white/10 bg-white/8 p-5">
                  <p className="text-sm font-semibold">Scalable app shell</p>
                  <p className="mt-2 text-sm leading-6 text-white/68">
                    Protected layouts, redirect rules, and sidebar navigation are ready for upcoming chat surfaces.
                  </p>
                </div>
              </div>
            </section>

            <section className="flex items-center justify-center">{children}</section>
          </div>
        </div>
      </PublicOnlyRoute>
    </Suspense>
  );
}
