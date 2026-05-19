import type { ReactNode } from "react";

type FieldProps = {
  label: string;
  hint?: string;
  error?: string | null;
  htmlFor?: string;
  children: ReactNode;
};

export function Field({ label, hint, error, htmlFor, children }: FieldProps) {
  return (
    <label className="grid min-w-0 gap-2" htmlFor={htmlFor}>
      <span className="text-sm font-semibold text-[var(--color-ink)]">{label}</span>
      {children}
      {error ? (
        <span className="text-sm text-[var(--color-danger)]">{error}</span>
      ) : hint ? (
        <span className="text-sm text-[var(--color-muted)]">{hint}</span>
      ) : null}
    </label>
  );
}
