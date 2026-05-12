"use client";

import {
  createContext,
  startTransition,
  useContext,
  useEffect,
  useState,
} from "react";

import type { LoginRequest, RegisterRequest, User, UserProfileUpdateRequest } from "@/lib/api/contracts";
import { ApiError } from "@/lib/api/client";
import { loginUser, registerUser } from "@/lib/api/auth";
import { fetchCurrentUser, updateCurrentUser } from "@/lib/api/users";
import { clearAccessToken, readAccessToken, writeAccessToken } from "@/lib/auth/token-storage";

type AuthStatus = "booting" | "authenticated" | "unauthenticated";

type AuthContextValue = {
  status: AuthStatus;
  token: string | null;
  user: User | null;
  error: string | null;
  isAuthenticated: boolean;
  login: (payload: LoginRequest) => Promise<void>;
  register: (payload: RegisterRequest) => Promise<void>;
  logout: () => void;
  refreshCurrentUser: () => Promise<void>;
  saveSupportedProfile: (payload: UserProfileUpdateRequest) => Promise<User>;
  clearError: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function resolveCurrentUser(token: string) {
  return fetchCurrentUser(token);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(() => readAccessToken());
  const [status, setStatus] = useState<AuthStatus>(() => (readAccessToken() ? "booting" : "unauthenticated"));
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState<string | null>(null);

  function finalizeLogout() {
    clearAccessToken();
    startTransition(() => {
      setToken(null);
      setUser(null);
      setStatus("unauthenticated");
    });
  }

  useEffect(() => {
    if (!token || status !== "booting") {
      return;
    }

    const sessionToken = token;
    let isActive = true;
    async function initializeSession() {
      try {
        const currentUser = await resolveCurrentUser(sessionToken);
        if (!isActive) {
          return;
        }
        startTransition(() => {
          setUser(currentUser);
          setStatus("authenticated");
        });
      } catch {
        if (!isActive) {
          return;
        }
        finalizeLogout();
      }
    }

    void initializeSession();
    return () => {
      isActive = false;
    };
  }, [status, token]);

  async function login(payload: LoginRequest) {
    setError(null);
    const authToken = await loginUser(payload);
    writeAccessToken(authToken.access_token);
    const currentUser = await resolveCurrentUser(authToken.access_token);
    startTransition(() => {
      setToken(authToken.access_token);
      setUser(currentUser);
      setStatus("authenticated");
    });
  }

  async function register(payload: RegisterRequest) {
    setError(null);
    await registerUser(payload);
    await login({
      email: payload.email,
      password: payload.password,
    });
  }

  function logout() {
    setError(null);
    finalizeLogout();
  }

  async function refreshCurrentUser() {
    if (!token) {
      finalizeLogout();
      return;
    }
    try {
      const currentUser = await resolveCurrentUser(token);
      startTransition(() => {
        setUser(currentUser);
        setStatus("authenticated");
      });
    } catch (caughtError) {
      if (caughtError instanceof ApiError && caughtError.status === 401) {
        finalizeLogout();
        return;
      }
      throw caughtError;
    }
  }

  async function saveSupportedProfile(payload: UserProfileUpdateRequest) {
    if (!token) {
      throw new Error("No active session");
    }
    const updatedUser = await updateCurrentUser(token, payload);
    startTransition(() => {
      setUser(updatedUser);
    });
    return updatedUser;
  }

  function clearError() {
    setError(null);
  }

  async function runAuthAction(action: () => Promise<void>) {
    try {
      await action();
    } catch (caughtError) {
      const message =
        caughtError instanceof ApiError ? caughtError.message : "Something went wrong. Please try again.";
      setError(message);
      throw caughtError;
    }
  }

  return (
    <AuthContext.Provider
      value={{
        status,
        token,
        user,
        error,
        isAuthenticated: status === "authenticated" && Boolean(token) && Boolean(user),
        login: (payload) => runAuthAction(() => login(payload)),
        register: (payload) => runAuthAction(() => register(payload)),
        logout,
        refreshCurrentUser,
        saveSupportedProfile,
        clearError,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
