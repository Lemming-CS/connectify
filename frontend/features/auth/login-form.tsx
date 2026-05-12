"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import { useAuth } from "@/components/providers/auth-provider";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { validateLogin } from "@/features/auth/validation";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login, error, clearError } = useAuth();
  const [values, setValues] = useState({ email: "", password: "" });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearError();

    const nextErrors = validateLogin(values);
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setIsSubmitting(true);
    try {
      await login({
        email: values.email.trim(),
        password: values.password,
      });
      router.replace(searchParams.get("next") || "/chat");
    } catch {
      // Error state is owned by the auth provider.
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Card className="w-full max-w-[520px] p-6 sm:p-8">
      <div className="space-y-2">
        <p className="text-sm uppercase tracking-[0.22em] text-[var(--color-muted)]">Welcome back</p>
        <h1 className="text-3xl font-semibold tracking-tight text-[var(--color-ink)]">Sign in to your workspace</h1>
        <p className="text-sm leading-6 text-[var(--color-muted)]">
          Use your Connectify account to restore your session and reattach to realtime events.
        </p>
      </div>

      <form className="mt-8 grid gap-5" onSubmit={handleSubmit}>
        {error ? <Banner tone="danger">{error}</Banner> : null}

        <Field label="Email" htmlFor="login-email" error={fieldErrors.email}>
          <Input
            id="login-email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={values.email}
            onChange={(event) => setValues((current) => ({ ...current, email: event.target.value }))}
          />
        </Field>

        <Field label="Password" htmlFor="login-password" error={fieldErrors.password}>
          <Input
            id="login-password"
            name="password"
            type="password"
            autoComplete="current-password"
            placeholder="Enter your password"
            value={values.password}
            onChange={(event) => setValues((current) => ({ ...current, password: event.target.value }))}
          />
        </Field>

        <Button busy={isSubmitting} type="submit">
          Log In
        </Button>
      </form>

      <p className="mt-6 text-sm text-[var(--color-muted)]">
        Need an account?{" "}
        <Link className="font-semibold text-[var(--color-accent)]" href="/register">
          Create one
        </Link>
      </p>
    </Card>
  );
}
