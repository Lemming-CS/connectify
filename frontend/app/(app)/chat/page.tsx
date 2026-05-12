import { Card } from "@/components/ui/card";

export default function MessengerHomePage() {
  return (
    <div className="grid flex-1 gap-6">
      <Card className="overflow-hidden">
        <div className="border-b border-[var(--color-card-border)] bg-[linear-gradient(135deg,rgba(255,255,255,0.65),rgba(255,244,232,0.85))] px-6 py-8 sm:px-8">
          <p className="text-sm uppercase tracking-[0.22em] text-[var(--color-muted)]">Messenger foundation</p>
          <h1 className="mt-3 max-w-2xl text-4xl font-semibold tracking-tight text-[var(--color-ink)]">
            The shell is ready for chats, groups, notifications, and call signaling.
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-[var(--color-muted)]">
            Authentication state, route protection, realtime wiring, and profile management are already integrated.
            Upcoming chat views can plug into the same API and websocket layers.
          </p>
        </div>

        <div className="grid gap-4 px-6 py-6 sm:grid-cols-3 sm:px-8">
          <div className="rounded-[24px] border border-[var(--color-card-border)] bg-white/72 p-5">
            <p className="text-sm font-semibold text-[var(--color-ink)]">Session-aware routing</p>
            <p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">
              Auth pages reject active sessions, and app routes restore persisted auth before rendering content.
            </p>
          </div>
          <div className="rounded-[24px] border border-[var(--color-card-border)] bg-white/72 p-5">
            <p className="text-sm font-semibold text-[var(--color-ink)]">Typed backend boundary</p>
            <p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">
              API utilities already cover login, registration, current user loading, profile updates, and realtime
              initialization.
            </p>
          </div>
          <div className="rounded-[24px] border border-[var(--color-card-border)] bg-white/72 p-5">
            <p className="text-sm font-semibold text-[var(--color-ink)]">Realtime baseline</p>
            <p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">
              The websocket manager reconnects with the active token and exposes connection state to the app shell.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
