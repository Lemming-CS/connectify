"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { useAuth } from "@/components/providers/auth-provider";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { validateRegistration } from "@/features/auth/validation";

export function RegisterForm() {
  const router = useRouter();
  const { register, error, clearError } = useAuth();
  const [values, setValues] = useState({
    email: "",
    username: "",
    password: "",
    confirmPassword: "",
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearError();

    const nextErrors = validateRegistration(values);
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setIsSubmitting(true);
    try {
      await register({
        email: values.email.trim(),
        username: values.username.trim(),
        password: values.password,
      });
      router.replace("/chat");
    } catch {
      // Provider owns the error message.
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Card className="w-full max-w-[560px] p-6 sm:p-8">
      <div className="space-y-2">
        <p className="text-sm uppercase tracking-[0.22em] text-[var(--color-muted)]">New workspace</p>
        <h1 className="text-3xl font-semibold tracking-tight text-[var(--color-ink)]">Create your account</h1>
        <p className="text-sm leading-6 text-[var(--color-muted)]">
          Register once and the app will persist your session locally for future visits.
        </p>
      </div>

      <form className="mt-8 grid gap-5" onSubmit={handleSubmit}>
        {error ? <Banner tone="danger">{error}</Banner> : null}

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Email" htmlFor="register-email" error={fieldErrors.email}>
            <Input
              id="register-email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={values.email}
              onChange={(event) => setValues((current) => ({ ...current, email: event.target.value }))}
            />
          </Field>

          <Field label="Username" htmlFor="register-username" error={fieldErrors.username}>
            <Input
              id="register-username"
              name="username"
              autoComplete="username"
              placeholder="connectify_handle"
              value={values.username}
              onChange={(event) => setValues((current) => ({ ...current, username: event.target.value }))}
            />
          </Field>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Password" htmlFor="register-password" error={fieldErrors.password}>
            <Input
              id="register-password"
              name="password"
              type="password"
              autoComplete="new-password"
              placeholder="At least 8 characters"
              value={values.password}
              onChange={(event) => setValues((current) => ({ ...current, password: event.target.value }))}
            />
          </Field>

          <Field label="Confirm password" htmlFor="register-confirm-password" error={fieldErrors.confirmPassword}>
            <Input
              id="register-confirm-password"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              placeholder="Repeat your password"
              value={values.confirmPassword}
              onChange={(event) => setValues((current) => ({ ...current, confirmPassword: event.target.value }))}
            />
          </Field>
        </div>

        <Button busy={isSubmitting} type="submit">
          Create Account
        </Button>
      </form>

      <p className="mt-6 text-sm text-[var(--color-muted)]">
        Already registered?{" "}
        <Link className="font-semibold text-[var(--color-accent)]" href="/login">
          Sign in
        </Link>
      </p>
    </Card>
  );
}
