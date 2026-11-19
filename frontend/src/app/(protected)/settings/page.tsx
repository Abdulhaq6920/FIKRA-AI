"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/features/auth/AuthContext";
import { motion } from "framer-motion";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  LogOut,
  Mail,
  Palette,
  Shield,
  ShieldCheck,
  User,
  XCircle,
} from "lucide-react";
import { ThemePicker } from "@/features/theme/ThemePicker";
import { api } from "@/lib/api/client";
import { errorText } from "@/lib/utils/errors";

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
            <SystemStatusCard />
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

type HealthState = "checking" | "ready" | "degraded" | "offline";

interface HealthPayload {
  status?: string;
  checks?: Record<string, string>;
}

const HEALTH_POLL_MS = 30_000;

/**
 * Live readiness card.
 *
 * This used to be three hard-coded lines claiming "System online / Healthy"
 * regardless of the backend's actual state — an outage looked identical to a
 * healthy deployment. It now reads `/health/ready` (public, no auth) and maps
 * the real answer to one of four states. 503 is a valid answer with a JSON
 * body, so the request bypasses the typed client (which would discard the
 * body and, for a 401, try to refresh a session) and parses it directly.
 */
function SystemStatusCard() {
  const [state, setState] = useState<HealthState>("checking");
  const [checks, setChecks] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(async (signal: AbortSignal) => {
    try {
      const response = await fetch("/api/v1/health/ready", {
        credentials: "include",
        signal,
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => ({}))) as HealthPayload;
      if (signal.aborted) return;
      setChecks(payload.checks ?? {});
      setError(null);
      // 200 means every *required* dependency is up; the body can still list
      // an optional dependency as degraded, which is worth showing.
      const anyDegraded = Object.values(payload.checks ?? {}).some((value) =>
        value.startsWith("degraded")
      );
      setState(response.ok ? (anyDegraded ? "degraded" : "ready") : "degraded");
    } catch (cause) {
      if (signal.aborted) return;
      setState("offline");
      setError(errorText(cause, "The health endpoint could not be reached."));
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void check(controller.signal);
    const interval = window.setInterval(() => void check(controller.signal), HEALTH_POLL_MS);
    const onFocus = () => void check(controller.signal);
    window.addEventListener("focus", onFocus);
    return () => {
      controller.abort();
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [check]);

  const presentation: Record<
    HealthState,
    { label: string; detail: string; badge: string; icon: React.ReactNode }
  > = {
    checking: {
      label: "Checking system status…",
      detail: "Contacting the health endpoint.",
      badge: "border-surface-700 bg-surface-800 text-surface-300",
      icon: <Loader2 className="h-4 w-4 animate-spin text-surface-400" />,
    },
    ready: {
      label: "System online",
      detail: "Chat, retrieval and document indexing services are operational.",
      badge: "border-emerald-400/25 bg-emerald-400/10 text-emerald-300",
      icon: <CheckCircle2 className="h-4 w-4 text-emerald-300" />,
    },
    degraded: {
      label: "System degraded",
      detail: "Some services are unavailable. Chat may be slower or documents may queue.",
      badge: "border-amber-400/25 bg-amber-400/10 text-amber-300",
      icon: <AlertTriangle className="h-4 w-4 text-amber-300" />,
    },
    offline: {
      label: "System unavailable",
      detail: "The backend could not be reached. Answers and uploads will fail.",
      badge: "border-red-400/25 bg-red-400/10 text-red-300",
      icon: <XCircle className="h-4 w-4 text-red-300" />,
    },
  };

  const view = presentation[state];
  const unhealthyChecks = Object.entries(checks).filter(
    ([, value]) => value !== "ok"
  );

  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-surface-800 bg-surface-950/40 p-3"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5">{view.icon}</span>
        <div>
          <p className="text-sm font-medium text-surface-100">{view.label}</p>
          <p className="text-xs text-surface-400">{view.detail}</p>
          {error && <p className="mt-1 text-xs text-red-300">{error}</p>}
          {unhealthyChecks.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-[11px] text-surface-400">
              {unhealthyChecks.map(([name, value]) => (
                <li key={name}>
                  <span className="text-surface-300">{name}</span>: {value}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <span
        className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${view.badge}`}
      >
        {state === "checking" ? "Checking" : state === "ready" ? "Healthy" : state === "degraded" ? "Degraded" : "Offline"}
      </span>
    </div>
  );
}
