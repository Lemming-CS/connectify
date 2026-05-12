export type AuthFormValues = {
  email: string;
  username?: string;
  password: string;
  confirmPassword?: string;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_PATTERN = /^[a-zA-Z0-9_]+$/;

export function validateLogin(values: AuthFormValues) {
  const errors: Record<string, string> = {};

  if (!values.email.trim()) {
    errors.email = "Email is required.";
  } else if (!EMAIL_PATTERN.test(values.email.trim())) {
    errors.email = "Enter a valid email address.";
  }

  if (!values.password) {
    errors.password = "Password is required.";
  }

  return errors;
}

export function validateRegistration(values: AuthFormValues) {
  const errors = validateLogin(values);

  if (!values.username?.trim()) {
    errors.username = "Username is required.";
  } else if (values.username.trim().length < 3) {
    errors.username = "Username must be at least 3 characters.";
  } else if (!USERNAME_PATTERN.test(values.username.trim())) {
    errors.username = "Use letters, numbers, or underscores only.";
  }

  if (values.password.length < 8) {
    errors.password = "Password must be at least 8 characters.";
  }

  if (!values.confirmPassword) {
    errors.confirmPassword = "Please confirm your password.";
  } else if (values.confirmPassword !== values.password) {
    errors.confirmPassword = "Passwords do not match.";
  }

  return errors;
}
