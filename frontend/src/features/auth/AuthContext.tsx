"use client";

/**
 * Authentication context.
 *
 * Provides the current user and auth actions (login, logout) to the whole app.
 * The user object is fetched from /api/v1/auth/me on mount — it is NEVER
 * derived from a token stored in localStorage.
 *
 * Security: tokens live in HttpOnly cookies set by the backend.
 * The frontend only knows whether the user is logged in by successfully
 * calling /me. It cannot read or modify the token.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { authApi } from "@/lib/api/auth";
import type { User, LoginRequest } from "@/types";

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  login: (data: LoginRequest) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();

  const refresh = useCallback(async () => {
    try {
      const me = await authApi.me();
      setUser(me);
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    refresh().finally(() => setIsLoading(false));
  }, [refresh]);

  const login = useCallback(
    async (data: LoginRequest) => {
      await authApi.login(data);
      const me = await authApi.me();
      setUser(me);
      if (me.is_platform_admin || me.organization_role === "org_admin") {
        router.push("/admin");
      } else {
        router.push("/chat");
      }
    },
    [router]
  );

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      setUser(null);
      router.push("/login");
    }
  }, [router]);

  return (
    <AuthContext.Provider value={{ user, isLoading, login, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
