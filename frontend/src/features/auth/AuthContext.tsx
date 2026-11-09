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
  login: (data: LoginRequest, options?: LoginOptions) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

interface LoginOptions {
  /**
   * Presentation-only pause between a successful login and the route change.
   * The auth shell uses it so the mascot's success animation (wink) is
   * visible before navigation unmounts the page. Business/auth logic is
   * unaffected — tokens and state are already set before the pause.
   */
  successDelayMs?: number;
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
    async (data: LoginRequest, options?: LoginOptions) => {
      await authApi.login(data);
      const me = await authApi.me();
      setUser(me);
      // Optional beat lets the auth page play its success animation before
      // navigation unmounts it.
      if (options?.successDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, options.successDelayMs));
      }
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
