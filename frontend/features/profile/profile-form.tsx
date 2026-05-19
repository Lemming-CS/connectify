"use client";

import { useEffect, useMemo, useState } from "react";

import type { PresenceStatus } from "@/lib/api/contracts";
import { useAuth } from "@/components/providers/auth-provider";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Panel, PanelHeader, StatusBadge } from "@/components/ui/panel";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  buildProfileFormValues,
  validateAvatarFile,
  validateProfile,
  type ProfileFormValues,
} from "@/features/profile/validation";

const STATUS_OPTIONS: Array<{ value: PresenceStatus; label: string }> = [
  { value: "online", label: "Online" },
  { value: "away", label: "Away" },
  { value: "busy", label: "Busy" },
  { value: "offline", label: "Offline" },
];

export function ProfileForm() {
  const { user, saveSupportedProfile } = useAuth();

  if (!user) {
    return (
      <Card className="p-6 sm:p-8">
        <p className="text-sm text-[var(--color-muted)]">Loading your profile…</p>
      </Card>
    );
  }

  return <ProfileFormFields key={user.updated_at} user={user} onSave={saveSupportedProfile} />;
}

type ProfileFormFieldsProps = {
  user: NonNullable<ReturnType<typeof useAuth>["user"]>;
  onSave: ReturnType<typeof useAuth>["saveSupportedProfile"];
};

function ProfileFormFields({ user, onSave }: ProfileFormFieldsProps) {
  const [values, setValues] = useState<ProfileFormValues>(() => buildProfileFormValues(user));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [capabilityMessage, setCapabilityMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const unsupportedChanges = useMemo(() => {
    const changes: string[] = [];
    if (values.username.trim() !== user.username) {
      changes.push("username");
    }
    if (values.displayName.trim() && values.displayName.trim() !== user.username) {
      changes.push("display name");
    }
    if (values.avatarFile) {
      changes.push("avatar file upload");
    }
    return changes;
  }, [user.username, values.avatarFile, values.displayName, values.username]);

  const avatarPreview = useMemo(() => {
    if (values.avatarFile) {
      return URL.createObjectURL(values.avatarFile);
    }
    return values.avatarUrl || null;
  }, [values.avatarFile, values.avatarUrl]);

  useEffect(() => {
    return () => {
      if (avatarPreview?.startsWith("blob:")) {
        URL.revokeObjectURL(avatarPreview);
      }
    };
  }, [avatarPreview]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setServerError(null);
    setSuccessMessage(null);

    const avatarFileError = validateAvatarFile(values.avatarFile);
    const nextErrors = validateProfile(values);
    if (avatarFileError) {
      nextErrors.avatarFile = avatarFileError;
    }
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    const payload = {
      avatar_url: values.avatarUrl.trim() || null,
      description: values.description.trim() || null,
      status: values.status,
    };

    setIsSubmitting(true);
    try {
      await onSave(payload);
      setSuccessMessage("Profile changes saved.");
      setCapabilityMessage(
        unsupportedChanges.length > 0
          ? `The current backend does not yet persist: ${unsupportedChanges.join(", ")}.`
          : null,
      );
    } catch (caughtError) {
      setServerError(caughtError instanceof Error ? caughtError.message : "Unable to update your profile.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
      <Card className="min-w-0 p-5 sm:p-8">
        <div className="min-w-0 space-y-2">
          <p className="text-sm uppercase tracking-[0.22em] text-[var(--color-muted)]">Profile settings</p>
          <h1 className="text-2xl font-semibold text-[var(--color-ink)] sm:text-3xl">Identity and presence</h1>
          <p className="max-w-3xl text-sm leading-6 text-[var(--color-muted)]">
            This screen is wired to the current backend contract. Status, bio, and avatar URL persist today; other
            fields are staged for future backend support.
          </p>
        </div>

        <form className="mt-8 grid min-w-0 gap-5" onSubmit={handleSubmit}>
          {serverError ? <Banner tone="danger">{serverError}</Banner> : null}
          {successMessage ? <Banner tone="success">{successMessage}</Banner> : null}
          {capabilityMessage ? <Banner>{capabilityMessage}</Banner> : null}

          <div className="grid min-w-0 gap-5 md:grid-cols-2">
            <Field
              label="Username"
              htmlFor="profile-username"
              error={fieldErrors.username}
              hint="Backend updates for usernames are not exposed yet."
            >
              <Input
                id="profile-username"
                value={values.username}
                onChange={(event) => setValues((current) => current && { ...current, username: event.target.value })}
              />
            </Field>

            <Field
              label="Display name"
              htmlFor="profile-display-name"
              error={fieldErrors.displayName}
              hint="Reserved in the UI for the upcoming profile expansion."
            >
              <Input
                id="profile-display-name"
                value={values.displayName}
                onChange={(event) => setValues((current) => current && { ...current, displayName: event.target.value })}
              />
            </Field>
          </div>

          <div className="grid min-w-0 gap-5 md:grid-cols-[minmax(0,1fr)_220px]">
            <Field
              label="Avatar URL"
              htmlFor="profile-avatar-url"
              error={fieldErrors.avatarUrl}
              hint="This is the avatar field currently persisted by the backend."
            >
              <Input
                id="profile-avatar-url"
                placeholder="https://example.com/avatar.jpg"
                value={values.avatarUrl}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  setValues((current) => current && { ...current, avatarUrl: nextValue });
                }}
              />
            </Field>

            <Field
              label="Avatar upload"
              htmlFor="profile-avatar-file"
              error={fieldErrors.avatarFile}
              hint="Client-side validation and preview are ready; file upload needs a backend media endpoint."
            >
              <Input
                id="profile-avatar-file"
                type="file"
                accept="image/*"
                onChange={(event) => {
                  const nextFile = event.target.files?.[0] ?? null;
                  setValues((current) => current && { ...current, avatarFile: nextFile });
                  setFieldErrors((current) => ({ ...current, avatarFile: validateAvatarFile(nextFile) ?? "" }));
                }}
              />
            </Field>
          </div>

          <div className="grid min-w-0 gap-5 md:grid-cols-[minmax(0,1fr)_220px]">
            <Field
              label="Bio"
              htmlFor="profile-description"
              error={fieldErrors.description}
              hint={`${values.description.length}/500 characters`}
            >
              <Textarea
                id="profile-description"
                placeholder="Tell your teammates what you are focused on."
                value={values.description}
                onChange={(event) => setValues((current) => current && { ...current, description: event.target.value })}
              />
            </Field>

            <Field label="Status" htmlFor="profile-status">
              <Select
                id="profile-status"
                value={values.status}
                onChange={(event) =>
                  setValues((current) => current && { ...current, status: event.target.value as PresenceStatus })
                }
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <Button busy={isSubmitting} type="submit">
              Save Profile
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                const nextValues = buildProfileFormValues(user);
                setValues(nextValues);
                setFieldErrors({});
                setServerError(null);
                setSuccessMessage(null);
                setCapabilityMessage(null);
              }}
            >
              Reset
            </Button>
          </div>
        </form>
      </Card>

      <Card className="min-w-0 p-5 sm:p-6">
        <PanelHeader eyebrow="Preview" title="Public profile" />
        <div className="mt-5 flex min-w-0 items-start gap-4">
          <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--color-card-strong)] text-xl font-semibold text-[var(--color-ink)] sm:size-20 sm:text-2xl">
            {avatarPreview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img alt="Avatar preview" className="size-full object-cover" src={avatarPreview} />
            ) : (
              user.username.slice(0, 1).toUpperCase()
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-lg font-semibold text-[var(--color-ink)]">{values.displayName || values.username}</p>
            <p className="truncate text-sm text-[var(--color-muted)]">@{values.username}</p>
            <StatusBadge className="mt-2 capitalize">{values.status}</StatusBadge>
          </div>
        </div>

        {values.description ? (
          <Panel className="mt-5 p-4">
            <p className="text-sm font-semibold text-[var(--color-ink)]">Bio</p>
            <p className="mt-2 break-words text-sm leading-6 text-[var(--color-muted)]">{values.description}</p>
          </Panel>
        ) : null}

        <Panel className="mt-5 p-4">
          <p className="text-sm font-semibold text-[var(--color-ink)]">Backend support today</p>
          <ul className="mt-3 space-y-2 text-sm leading-6 text-[var(--color-muted)]">
            <li>Persisted now: `description`, `status`, `avatar_url`</li>
            <li>UI staged only: `username`, `display name`, avatar file upload</li>
            <li>Current user fetching is restored automatically from the saved session token</li>
          </ul>
        </Panel>
      </Card>
    </div>
  );
}
