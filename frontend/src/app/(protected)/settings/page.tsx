"use client";

import { useState } from "react";
import { useAuth } from "@/features/auth/AuthContext";
import { motion } from "framer-motion";
import { User, Mail, Shield, LogOut, Palette, ShieldCheck, Activity } from "lucide-react";
import { ThemePicker } from "@/features/theme/ThemePicker";
import { api } from "@/lib/api/client";

export default function SettingsPage() {
  const { user, logout } = useAuth();
  const [accessRequestMessage, setAccessRequestMessage] = useState<string | null>(null);

  const isAdmin = Boolean(
    user?.is_platform_admin || user?.organization_role === "org_admin"
  );

  const requestAdminAccess = async () => {
    const reason = window.prompt("Why do you need organization-admin access?")?.trim();
    if (reason === undefined) return;
    try {
      await api.post("/access-requests", { reason: reason || null });
      setAccessRequestMessage("Request sent to your organization administrators.");
    } catch (err) {
      setAccessRequestMessage(
        err instanceof Error ? err.message : "Could not send the request."
      );
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-surface-950 p-6">
      <div className="mx-auto max-w-5xl">
        <h1 className="mb-6 text-xl font-semibold text-surface-100">Settings</h1>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="mb-4 overflow-hidden rounded-xl border border-surface-800 bg-surface-900"
        >
          <div className="border-b border-surface-800 px-5 py-4">
            <h2 className="text-sm font-medium text-surface-200">Account</h2>
          </div>
          <div className="space-y-4 p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full border border-brand-500/40 bg-brand-600/30 text-brand-400">
                <User className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-medium text-surface-100">{user?.full_name}</p>
                <p className="text-xs text-surface-400">{user?.email}</p>
              </div>
            </div>

            <div className="flex items-center gap-3 rounded-lg bg-surface-800/60 p-3">
              <Shield className="h-4 w-4 text-surface-400" />
              <span className="text-sm text-surface-300">
                {user?.is_platform_admin
                  ? "Platform Administrator"
                  : user?.organization_role === "org_admin"
                    ? "Organization Administrator"
                    : "Organization Member"}
              </span>
            </div>

            <div className="flex items-center gap-3 rounded-lg bg-surface-800/60 p-3">
              <Mail className="h-4 w-4 text-surface-400" />
              <span className="text-sm text-surface-300">Account status: {user?.status}</span>
            </div>

            {!isAdmin && (
              <div className="rounded-lg border border-brand-500/25 bg-brand-500/5 p-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-start gap-2">
                    <ShieldCheck className="mt-0.5 h-4 w-4 flex-shrink-0 text-brand-500" />
                    <div>
                      <p className="text-sm text-surface-200">Need admin tools?</p>
                      <p className="text-xs text-surface-500">
                        Ask your organization administrators for elevated access.
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={requestAdminAccess}
                    className="rounded-lg border border-brand-500/40 bg-brand-500/10 px-3 py-1.5 text-xs font-medium text-brand-500 transition-colors hover:bg-brand-500/20 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
                  >
                    Request admin access
                  </button>
                </div>
                {accessRequestMessage && (
                  <p className="mt-3 text-xs text-surface-400" role="status">
                    {accessRequestMessage}
                  </p>
                )}
              </div>
            )}
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.04 }}
          className="mb-4 overflow-hidden rounded-xl border border-surface-800 bg-surface-900"
        >
          <div className="flex items-center gap-2 border-b border-surface-800 px-5 py-4">
            <Activity className="h-4 w-4 text-brand-400" />
            <h2 className="text-sm font-medium text-surface-200">System status</h2>
          </div>
          <div className="p-5">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-400/20 bg-emerald-400/5 p-3">
              <div className="flex items-center gap-3">
                <span className="relative flex h-2.5 w-2.5" aria-hidden="true">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-300" />
                </span>
                <div>
                  <p className="text-sm font-medium text-emerald-200">System online</p>
                  <p className="text-xs text-surface-400">
                    Chat, retrieval and document indexing services are operational.
                  </p>
                </div>
              </div>
              <span className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-300">
                Healthy
              </span>
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.06 }}
          className="mb-4 overflow-hidden rounded-xl border border-surface-800 bg-surface-900"
        >
          <div className="flex items-center gap-2 border-b border-surface-800 px-5 py-4">
            <Palette className="h-4 w-4 text-brand-400" />
            <h2 className="text-sm font-medium text-surface-200">Appearance</h2>
          </div>
          <div className="p-5">
            <ThemePicker />
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.1 }}
          className="overflow-hidden rounded-xl border border-surface-800 bg-surface-900"
        >
          <div className="border-b border-surface-800 px-5 py-4">
            <h2 className="text-sm font-medium text-surface-200">Session</h2>
          </div>
          <div className="p-5">
            <button
              onClick={() => logout()}
              className="flex items-center gap-2 rounded-lg border border-red-500/30 px-4 py-2 text-sm text-red-400 transition-colors hover:bg-red-500/10 focus:outline-none focus:ring-2 focus:ring-red-500/40"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
