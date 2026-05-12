import type { PresenceStatus, User } from "@/lib/api/contracts";

export const AVATAR_MAX_BYTES = 10 * 1024 * 1024;

export type ProfileFormValues = {
  username: string;
  displayName: string;
  avatarUrl: string;
  description: string;
  status: PresenceStatus;
  avatarFile: File | null;
};

export function buildProfileFormValues(user: User): ProfileFormValues {
  return {
    username: user.username,
    displayName: user.username,
    avatarUrl: user.avatar_url ?? "",
    description: user.description ?? "",
    status: user.status,
    avatarFile: null,
  };
}

export function validateProfile(values: ProfileFormValues) {
  const errors: Record<string, string> = {};

  if (!values.username.trim()) {
    errors.username = "Username is required.";
  } else if (values.username.trim().length < 3) {
    errors.username = "Username must be at least 3 characters.";
  } else if (!/^[a-zA-Z0-9_]+$/.test(values.username.trim())) {
    errors.username = "Username may only include letters, numbers, and underscores.";
  }

  if (values.displayName.trim().length > 48) {
    errors.displayName = "Display name must be 48 characters or fewer.";
  }

  if (values.description.length > 500) {
    errors.description = "Bio must stay within 500 characters.";
  }

  if (values.avatarUrl.trim()) {
    try {
      const url = new URL(values.avatarUrl.trim());
      if (!["http:", "https:"].includes(url.protocol)) {
        errors.avatarUrl = "Avatar URL must use http or https.";
      }
    } catch {
      errors.avatarUrl = "Enter a valid avatar URL.";
    }
  }

  return errors;
}

export function validateAvatarFile(file: File | null) {
  if (!file) {
    return null;
  }
  if (!file.type.startsWith("image/")) {
    return "Avatar files must be images.";
  }
  if (file.size > AVATAR_MAX_BYTES) {
    return "Avatar files must be 10 MB or smaller.";
  }
  return null;
}
