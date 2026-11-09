"use client";

/**
 * Analytics — one page for everyone.
 *
 * Members see only their own activity (the backend scopes every metric to the
 * caller). Admins additionally get an organization view, which is now the only
 * home for organization analytics. The previous Admin → Analytics tab redirects
 * here with `?view=organization`.
 */

import { useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BarChart3, UserRound } from "lucide-react";
import { useAuth } from "@/features/auth/AuthContext";
import { CurrencySwitch } from "@/features/currency/CurrencySwitch";
import { cn } from "@/lib/utils/cn";
import { PersonalAnalytics } from "@/features/analytics/PersonalAnalytics";
import { OrganizationAnalytics } from "@/features/analytics/OrganizationAnalytics";

type View = "personal" | "organization";

export default function AnalyticsPage() {
  const { user } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const isAdmin = Boolean(user?.is_platform_admin || user?.organization_role === "org_admin");

  const requested = params.get("view");
  const view: View = !isAdmin
    ? "personal"
    : requested === "personal"
      ? "personal"
      : "organization";

  const switchView = useCallback(
    (next: View) => {
      router.replace(`/analytics?view=${next}`, { scroll: false });
    },
    [router],
  );

  return (
    <div className="h-full overflow-y-auto bg-surface-950 p-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-surface-100">Analytics</h1>
            <p className="mt-0.5 text-sm text-surface-400">
              {view === "organization"
                ? "Organization-wide activity, cost, and member performance."
                : "Your own activity, cost, and feedback. Only you can see this data."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* Cost displays live only on this page, so the display-currency
                toggle belongs here rather than in the global app header. */}
            <CurrencySwitch />
            {isAdmin && (
              <div
                className="inline-flex items-center rounded-lg border border-surface-800 bg-surface-900 p-0.5"
                role="group"
                aria-label="Analytics view"
              >
                <button
                  type="button"
                  onClick={() => switchView("organization")}
                  aria-pressed={view === "organization"}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500",
                    view === "organization"
                      ? "bg-brand-500/20 text-brand-200"
                      : "text-surface-400 hover:bg-surface-800 hover:text-surface-200",
                  )}
                >
                  <BarChart3 className="h-3.5 w-3.5" />
                  Organization
                </button>
                <button
                  type="button"
                  onClick={() => switchView("personal")}
                  aria-pressed={view === "personal"}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500",
                    view === "personal"
                      ? "bg-brand-500/20 text-brand-200"
                      : "text-surface-400 hover:bg-surface-800 hover:text-surface-200",
                  )}
                >
                  <UserRound className="h-3.5 w-3.5" />
                  My activity
                </button>
              </div>
            )}
          </div>
        </div>

        {view === "organization" && isAdmin ? (
          <OrganizationAnalytics />
        ) : (
          <PersonalAnalytics />
        )}
      </div>
    </div>
  );
}
