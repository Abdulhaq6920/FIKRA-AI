"use client";

/**
 * Protected layout — wraps all authenticated pages with the AppShell.
 * Redirects unauthenticated users to /login.
 *
 * Security note: the real authorization boundary is the backend API.
 * This layout is a usability guard, not a security control.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/features/auth/AuthContext";
import { AppShell } from "@/components/layout/AppShell";
import { Loader2 } from "lucide-react";

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace("/login");
    }
  }, [user, isLoading, router]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-surface-950">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 text-brand-400 animate-spin" />
          <p className="text-sm text-surface-400">Loading…</p>
        </div>
      </div>
    );
  }

  if (!user) return null; // Will redirect

  return <AppShell>{children}</AppShell>;
}
