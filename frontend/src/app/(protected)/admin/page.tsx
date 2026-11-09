"use client";

/**
 * Organization Admin dashboard.
 * Tabs: Overview · Users · Questions · Documents · Feedback · Access Requests
 *
 * Organization analytics deliberately live on the Analytics page, which admins
 * open with `/analytics?view=organization`. The legacy `?tab=Analytics` deep
 * link redirects there.
 */

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Users,
  FileText,
  MessageSquare,
  Shield,
  AlertTriangle,
  RefreshCw,
  Search,
} from "lucide-react";
import { useAuth } from "@/features/auth/AuthContext";
import { api } from "@/lib/api/client";
import { adminApi } from "@/lib/api/admin";
import { DocumentsTab } from "@/features/admin/DocumentsTab";
import { QuestionsTab } from "@/features/admin/QuestionsTab";
import type {
  AdminUser,
  AdminUserRole,
  FeedbackItem,
  AccessRequest,
  PagedResponse,
} from "@/lib/api/admin";
import { cn } from "@/lib/utils/cn";

// ─── Types ────────────────────────────────────────────────────────────────

interface FailedJob {
  id: string;
  document_id: string;
  document_title: string;
  status: "failed" | "dead";
  error_message: string | null;
  updated_at: string;
}

interface AdminOverview {
  failed_jobs: FailedJob[];
}

const TABS = [
  "Overview",
  "Users",
  "Questions",
  "Documents",
  "Feedback",
  "Access Requests",
] as const;
type Tab = (typeof TABS)[number];

// ─── Page ─────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const tabParam = searchParams.get("tab");
  const legacyAnalytics = (tabParam ?? "").toLowerCase() === "analytics";
  const activeTab: Tab =
    TABS.find((tab) => tab.toLowerCase() === (tabParam ?? "").toLowerCase()) ?? "Overview";

  // The Analytics tab moved to the dedicated Analytics page. Redirect old
  // bookmarks and deep links instead of silently showing Overview.
  useEffect(() => {
    if (legacyAnalytics) router.replace("/analytics?view=organization");
  }, [legacyAnalytics, router]);

  const setActiveTab = useCallback(
    (tab: Tab) => {
      if (tab === activeTab) return;
      const params = new URLSearchParams(searchParams.toString());
      if (tab === "Overview") params.delete("tab");
      else params.set("tab", tab);
      // Member filters belong to the Questions tab only; switching tabs must
      // not silently carry a stale deep-link filter with it.
      if (tab !== "Questions") {
        params.delete("user");
        params.delete("userName");
      }
      const query = params.toString();
      // URL-backed tabs make browser back/forward (and the app's history
      // buttons) move between tabs instead of leaving the admin page.
      router.push(query ? `${pathname}?${query}` : pathname);
    },
    [activeTab, pathname, router, searchParams]
  );

  const isAdmin = user?.is_platform_admin || user?.organization_role === "org_admin";

  if (legacyAnalytics) return null;

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center h-full bg-surface-950">
        <div className="text-center">
          <Shield className="w-12 h-12 text-surface-600 mx-auto mb-3" />
          <h2 className="text-lg font-semibold text-surface-100 mb-1">Access Denied</h2>
          <p className="text-sm text-surface-400">You do not have permission to view this page.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-surface-950 p-6">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-surface-100">Admin Dashboard</h1>
          <p className="text-sm text-surface-400 mt-0.5">Live organization overview and management</p>
        </div>

        {/* Tabs */}
        <div className="flex flex-wrap gap-1 mb-6 border-b border-surface-800">
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                "px-4 py-2 text-sm font-medium transition-colors -mb-px border-b-2",
                activeTab === tab
                  ? "border-brand-400 text-brand-300"
                  : "border-transparent text-surface-400 hover:text-surface-200"
              )}
            >
              {tab}
            </button>
          ))}
        </div>

        {activeTab === "Overview" && <OverviewTab onNavigate={setActiveTab} />}
        {activeTab === "Users" && <UsersTab />}
        {activeTab === "Questions" && <QuestionsTab />}
        {activeTab === "Documents" && <DocumentsTab />}
        {activeTab === "Feedback" && <FeedbackTab />}
        {activeTab === "Access Requests" && <AccessRequestsTab />}
      </div>
    </div>
  );
}

// ─── Overview tab ─────────────────────────────────────────────────────────

function OverviewTab({ onNavigate }: { onNavigate: (tab: Tab) => void }) {
  const [stats, setStats] = useState<AdminOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const overview = await api.get<AdminOverview>("/admin/overview");
        if (!cancelled) { setStats(overview); setError(null); setLastUpdated(new Date()); }
      } catch {
        if (!cancelled) setError("Live data is temporarily unavailable.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    const interval = window.setInterval(load, 10_000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, []);

  const quickLinks: Array<{
    tab: Tab;
    label: string;
    description: string;
    icon: typeof Users;
    color: string;
    bg: string;
  }> = [
    {
      tab: "Users",
      label: "Manage users",
      description: "Add members, change roles, reset passwords.",
      icon: Users,
      color: "text-blue-300",
      bg: "bg-blue-500/10",
    },
    {
      tab: "Questions",
      label: "Review questions",
      description: "Inspect questions, answers, sources, and feedback.",
      icon: MessageSquare,
      color: "text-purple-300",
      bg: "bg-purple-500/10",
    },
    {
      tab: "Documents",
      label: "Knowledge base",
      description: "Upload, re-index, and check document status.",
      icon: FileText,
      color: "text-emerald-300",
      bg: "bg-emerald-500/10",
    },
    {
      tab: "Feedback",
      label: "Feedback review",
      description: "Triage negative answers and mark them solved.",
      icon: AlertTriangle,
      color: "text-amber-300",
      bg: "bg-amber-500/10",
    },
    {
      tab: "Access Requests",
      label: "Admin requests",
      description: "Approve or reject administrator access.",
      icon: Shield,
      color: "text-cyan-300",
      bg: "bg-cyan-500/10",
    },
  ];

  return (
    <div className="space-y-6">
      {error && (
        <div className="flex items-center gap-3 rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          <RefreshCw className="h-4 w-4 shrink-0 animate-spin" />
          <span>{error}</span>
        </div>
      )}
      {lastUpdated && (
        <p className="text-xs text-surface-500">
          Updated {lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
        </p>
      )}

      {/* Management shortcuts — no stat tiles here; live totals live in Analytics. */}
      <Section title="Management" icon={<Search className="w-4 h-4" />}>
        <div className="grid grid-cols-1 divide-y divide-surface-800/80 sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-3">
          {quickLinks.map(({ tab, label, description, icon: Icon, color, bg }) => (
            <button
              key={tab}
              type="button"
              onClick={() => onNavigate(tab)}
              className="flex items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-800/40 focus:outline-none focus:ring-1 focus:ring-brand-500"
            >
              <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", bg)}>
                <Icon className={cn("h-4 w-4", color)} />
              </div>
              <div className="min-w-0">
                <p className="text-sm text-surface-200">{label}</p>
                <p className="mt-0.5 text-xs text-surface-500">{description}</p>
              </div>
            </button>
          ))}
        </div>
      </Section>

      {/* Failed jobs */}
      <Section title="Failed Ingestion Jobs" icon={<AlertTriangle className="w-4 h-4" />}>
        {loading ? (
          <Skeleton rows={2} />
        ) : stats?.failed_jobs.length ? (
          <div className="divide-y divide-surface-800/80">
            {stats.failed_jobs.map((job) => (
              <div key={job.id} className="px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="truncate text-sm text-surface-200">{job.document_title}</p>
                  <span className="rounded-full bg-red-500/10 px-2 py-1 text-[10px] font-semibold uppercase text-red-300">{job.status}</span>
                </div>
                <p className="mt-1 truncate text-xs text-surface-500">{job.error_message || "Processing did not complete."}</p>
              </div>
            ))}
          </div>
        ) : <EmptyRow text="No failed ingestion jobs." />}
      </Section>
    </div>
  );
}

// ─── Users tab ────────────────────────────────────────────────────────────

const ROLE_FILTERS = [
  { value: "", label: "All roles" },
  { value: "admin", label: "Admins" },
  { value: "member", label: "Members" },
] as const;

const STATUS_FILTERS = [
  { value: "", label: "All" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
] as const;

type RoleFilter = "" | "admin" | "member";
type StatusFilter = "" | "active" | "inactive";

interface UserFeedback {
  kind: "error" | "success";
  message: string;
}

function UsersTab() {
  const { user: currentUser } = useAuth();
  const [data, setData] = useState<PagedResponse<AdminUser> | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("");
  const [feedback, setFeedback] = useState<UserFeedback | null>(null);
  const [actioning, setActioning] = useState<string | null>(null);

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createEmail, setCreateEmail] = useState("");
  const [createPassword, setCreatePassword] = useState("");
  const [createRole, setCreateRole] = useState<AdminUserRole>("member");
  const [creating, setCreating] = useState(false);

  // Password reset
  const [resetFor, setResetFor] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [resetting, setResetting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await adminApi.listUsers({
        page,
        page_size: 20,
        search: search || undefined,
        role: roleFilter || undefined,
        is_active: statusFilter === "" ? undefined : statusFilter === "active",
      });
      setData(result);
    } catch (err) {
      setFeedback({
        kind: "error",
        message: err instanceof Error ? err.message : "Could not load users.",
      });
    } finally {
      setLoading(false);
    }
  }, [page, search, roleFilter, statusFilter]);

  useEffect(() => { load(); }, [load]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    setSearch(searchInput.trim());
  };

  const runAction = async (successMessage: string, id: string, action: () => Promise<void>) => {
    setActioning(id);
    setFeedback(null);
    try {
      await action();
      await load();
      setFeedback({ kind: "success", message: successMessage });
    } catch (err) {
      setFeedback({
        kind: "error",
        message: err instanceof Error ? err.message : "Action failed.",
      });
    } finally {
      setActioning(null);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setFeedback(null);
    try {
      await adminApi.createUser({
        full_name: createName.trim(),
        email: createEmail.trim(),
        password: createPassword,
        role: createRole,
      });
      setFeedback({ kind: "success", message: `Created ${createEmail.trim()}.` });
      setCreateName("");
      setCreateEmail("");
      setCreatePassword("");
      setCreateRole("member");
      setShowCreate(false);
      setPage(1);
      await load();
    } catch (err) {
      setFeedback({
        kind: "error",
        message: err instanceof Error ? err.message : "Could not create user.",
      });
    } finally {
      setCreating(false);
    }
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetFor) return;
    setResetting(true);
    setFeedback(null);
    try {
      await adminApi.resetUserPassword(resetFor, resetPassword);
      setFeedback({
        kind: "success",
        message: "Password updated. Active sessions were signed out.",
      });
      setResetFor(null);
      setResetPassword("");
    } catch (err) {
      setFeedback({
        kind: "error",
        message: err instanceof Error ? err.message : "Could not reset password.",
      });
    } finally {
      setResetting(false);
    }
  };

  const totalPages = data ? Math.max(1, Math.ceil(data.total / 20)) : 1;
  const canManagePlatformAdmins = Boolean(currentUser?.is_platform_admin);

  const inputClass =
    "w-full rounded-lg bg-surface-800 border border-surface-700 px-3 py-1.5 text-xs text-surface-100 placeholder:text-surface-500 outline-none focus:ring-1 focus:ring-brand-500";

  return (
    <Section title="Organization Users" icon={<Users className="w-4 h-4" />}>
      {/* Toolbar */}
      <div className="space-y-3 px-4 py-3 border-b border-surface-800">
        <div className="flex flex-wrap items-center gap-2">
          <form onSubmit={handleSearch} className="flex gap-2 flex-1 min-w-[220px]">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-surface-500" />
              <input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search by name or email…"
                className="w-full rounded-lg bg-surface-800 border border-surface-700 pl-8 pr-3 py-1.5 text-xs text-surface-100 placeholder:text-surface-500 outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>
            <button type="submit" className="rounded-lg bg-brand-600/20 border border-brand-500/30 px-3 py-1.5 text-xs text-brand-300 hover:bg-brand-600/30">
              Search
            </button>
          </form>
          <button
            type="button"
            onClick={() => { setShowCreate((v) => !v); setFeedback(null); }}
            className={cn(
              "rounded-lg px-3 py-1.5 text-xs font-medium border transition-colors",
              showCreate
                ? "bg-surface-800 border-surface-700 text-surface-300 hover:text-surface-100"
                : "bg-brand-600/20 border-brand-500/30 text-brand-300 hover:bg-brand-600/30"
            )}
          >
            {showCreate ? "Cancel" : "+ Add user"}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wide text-surface-500">Role</span>
            {ROLE_FILTERS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => { setPage(1); setRoleFilter(value); }}
                className={cn(
                  "rounded-full px-2.5 py-1 text-[11px] transition-colors",
                  roleFilter === value
                    ? "bg-brand-600/30 text-brand-300 border border-brand-500/30"
                    : "bg-surface-800 text-surface-400 hover:text-surface-200"
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wide text-surface-500">Status</span>
            {STATUS_FILTERS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => { setPage(1); setStatusFilter(value); }}
                className={cn(
                  "rounded-full px-2.5 py-1 text-[11px] transition-colors",
                  statusFilter === value
                    ? "bg-brand-600/30 text-brand-300 border border-brand-500/30"
                    : "bg-surface-800 text-surface-400 hover:text-surface-200"
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {feedback && (
          <div
            className={cn(
              "rounded-lg border px-3 py-2 text-xs",
              feedback.kind === "error"
                ? "border-red-500/25 bg-red-500/10 text-red-200"
                : "border-emerald-500/25 bg-emerald-500/10 text-emerald-200"
            )}
          >
            {feedback.message}
          </div>
        )}

        {showCreate && (
          <form onSubmit={handleCreate} className="grid grid-cols-1 sm:grid-cols-2 gap-2 rounded-lg border border-surface-800 bg-surface-950/40 p-3">
            <input
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              placeholder="Full name"
              required
              maxLength={255}
              className={inputClass}
            />
            <input
              type="email"
              value={createEmail}
              onChange={(e) => setCreateEmail(e.target.value)}
              placeholder="Email address"
              required
              className={inputClass}
            />
            <input
              type="password"
              value={createPassword}
              onChange={(e) => setCreatePassword(e.target.value)}
              placeholder="Password (min 8 characters)"
              required
              minLength={8}
              maxLength={128}
              className={inputClass}
            />
            <div className="flex gap-2">
              <select
                value={createRole}
                onChange={(e) => setCreateRole(e.target.value as AdminUserRole)}
                className={cn(inputClass, "flex-1")}
                aria-label="Role for new user"
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
              <button
                type="submit"
                disabled={creating}
                className="rounded-lg bg-brand-600/30 border border-brand-500/40 px-3 py-1.5 text-xs font-medium text-brand-200 hover:bg-brand-600/40 disabled:opacity-40"
              >
                {creating ? "Creating…" : "Create"}
              </button>
            </div>
          </form>
        )}
      </div>

      {loading ? <Skeleton rows={5} /> : data?.items.length ? (
        <>
          <div className="divide-y divide-surface-800/80">
            {data.items.map((member) => {
              const platformBlocked = member.is_platform_admin && !canManagePlatformAdmins;
              const busy = actioning === member.id;
              const controlsDisabled = busy || member.is_self || platformBlocked;
              return (
                <div key={member.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <div
                      className={cn(
                        "flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold flex-shrink-0",
                        member.is_active
                          ? "bg-brand-500/15 text-brand-300"
                          : "bg-surface-800 text-surface-500"
                      )}
                    >
                      {member.full_name.slice(0, 1).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <p className={cn("truncate text-sm", member.is_active ? "text-surface-200" : "text-surface-500")}>
                          {member.full_name}
                        </p>
                        {member.is_self && (
                          <span className="rounded-full bg-surface-800 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-surface-400">
                            You
                          </span>
                        )}
                        {member.is_platform_admin && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-cyan-400/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-cyan-300">
                            <Shield className="h-2.5 w-2.5" /> Platform
                          </span>
                        )}
                      </div>
                      <p className="truncate text-xs text-surface-500">{member.email}</p>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span
                        className={cn(
                          "rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-wide",
                          member.is_active
                            ? "bg-emerald-500/10 text-emerald-300"
                            : "bg-surface-800 text-surface-500"
                        )}
                      >
                        {member.is_active ? "Active" : "Inactive"}
                      </span>

                      <select
                        value={member.role}
                        disabled={controlsDisabled}
                        onChange={(e) => {
                          const nextRole = e.target.value as AdminUserRole;
                          runAction(`Role updated to ${nextRole}.`, member.id, () =>
                            adminApi
                              .updateUser(member.id, { role: nextRole })
                              .then(() => undefined)
                          );
                        }}
                        aria-label={`Role for ${member.full_name}`}
                        className="rounded-lg bg-surface-800 border border-surface-700 px-2 py-1 text-[11px] text-surface-200 outline-none focus:ring-1 focus:ring-brand-500 disabled:opacity-40"
                      >
                        <option value="member">Member</option>
                        <option value="admin">Admin</option>
                      </select>

                      <button
                        type="button"
                        disabled={controlsDisabled}
                        onClick={() =>
                          runAction(
                            member.is_active ? "User deactivated." : "User activated.",
                            member.id,
                            () =>
                              adminApi
                                .updateUser(member.id, { is_active: !member.is_active })
                                .then(() => undefined)
                          )
                        }
                        className={cn(
                          "rounded px-2.5 py-1 text-[11px] transition-colors disabled:opacity-40",
                          member.is_active
                            ? "bg-red-400/10 text-red-200 hover:bg-red-400/20"
                            : "bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/20"
                        )}
                      >
                        {member.is_active ? "Deactivate" : "Activate"}
                      </button>

                      <button
                        type="button"
                        disabled={busy || platformBlocked}
                        onClick={() => {
                          setResetFor(resetFor === member.id ? null : member.id);
                          setResetPassword("");
                          setFeedback(null);
                        }}
                        className="rounded px-2.5 py-1 text-[11px] text-surface-300 hover:bg-surface-800 disabled:opacity-40"
                      >
                        {resetFor === member.id ? "Cancel" : "Reset password"}
                      </button>
                    </div>
                  </div>

                  {resetFor === member.id && (
                    <form onSubmit={handleReset} className="mt-2 flex flex-wrap gap-2">
                      <input
                        type="password"
                        value={resetPassword}
                        onChange={(e) => setResetPassword(e.target.value)}
                        placeholder="New password (min 8 characters)"
                        required
                        minLength={8}
                        maxLength={128}
                        className={cn(inputClass, "flex-1 min-w-[200px]")}
                      />
                      <button
                        type="submit"
                        disabled={resetting || resetPassword.length < 8}
                        className="rounded-lg bg-brand-600/30 border border-brand-500/40 px-3 py-1.5 text-xs font-medium text-brand-200 hover:bg-brand-600/40 disabled:opacity-40"
                      >
                        {resetting ? "Saving…" : "Save password"}
                      </button>
                    </form>
                  )}
                </div>
              );
            })}
          </div>
          <Pagination page={page} totalPages={totalPages} total={data.total} onPrev={() => setPage((p) => p - 1)} onNext={() => setPage((p) => p + 1)} />
        </>
      ) : <EmptyRow text="No users found." />}
    </Section>
  );
}

// ─── Feedback tab ─────────────────────────────────────────────────────────

const FEEDBACK_STATUSES = [
  { value: "", label: "All" },
  { value: "open", label: "Open" },
  { value: "in_review", label: "In Review" },
  { value: "solved", label: "Solved" },
];

function FeedbackTab() {
  const [data, setData] = useState<PagedResponse<FeedbackItem> | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("");
  const [actioning, setActioning] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await adminApi.getFeedback(page, 20, statusFilter || undefined);
      setData(result);
    } catch { /* keep previous */ }
    finally { setLoading(false); }
  }, [page, statusFilter]);

  useEffect(() => { load(); }, [load]);

  const action = async (id: string, status: "in_review" | "solved") => {
    setActioning(id);
    try {
      await adminApi.updateFeedback(id, status);
      await load();
    } catch { /* ignore */ }
    finally { setActioning(null); }
  };

  const totalPages = data ? Math.max(1, Math.ceil(data.total / 20)) : 1;

  return (
    <Section title="Feedback Review" icon={<MessageSquare className="w-4 h-4" />}>
      <div className="px-4 py-3 border-b border-surface-800 flex gap-2">
        {FEEDBACK_STATUSES.map(({ value, label }) => (
          <button
            key={value}
            onClick={() => { setPage(1); setStatusFilter(value); }}
            className={cn(
              "rounded-full px-3 py-1 text-xs transition-colors",
              statusFilter === value
                ? "bg-brand-600/30 text-brand-300 border border-brand-500/30"
                : "bg-surface-800 text-surface-400 hover:text-surface-200"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? <Skeleton rows={4} /> : data?.items.length ? (
        <>
          <div className="divide-y divide-surface-800/80">
            {data.items.map((item) => (
              <div key={item.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={cn(
                        "text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full",
                        item.feedback_type === "thumbs_up" ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"
                      )}>
                        {item.feedback_type === "thumbs_up" ? "👍 Positive" : "👎 Negative"}
                      </span>
                      <StatusBadge status={item.review_status} />
                    </div>
                    <p className="text-xs text-surface-400">{item.user_name} · {item.user_email}</p>
                    {item.comment && <p className="mt-1 text-xs text-surface-300 italic">"{item.comment}"</p>}
                    <p className="mt-1 text-xs text-surface-500 line-clamp-2">{item.message_excerpt}</p>
                  </div>
                </div>
                {item.feedback_type !== "thumbs_up" && item.review_status !== "solved" && (
                  <div className="mt-2 flex gap-2">
                    {item.review_status !== "in_review" && (
                      <button
                        disabled={actioning === item.id}
                        onClick={() => action(item.id, "in_review")}
                        className="rounded bg-amber-400/10 px-2.5 py-1 text-[11px] text-amber-200 hover:bg-amber-400/20 disabled:opacity-40"
                      >
                        Mark In Review
                      </button>
                    )}
                    <button
                      disabled={actioning === item.id}
                      onClick={() => action(item.id, "solved")}
                      className="rounded bg-emerald-400/10 px-2.5 py-1 text-[11px] text-emerald-200 hover:bg-emerald-400/20 disabled:opacity-40"
                    >
                      Mark Solved
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
          <Pagination page={page} totalPages={totalPages} total={data.total} onPrev={() => setPage((p) => p - 1)} onNext={() => setPage((p) => p + 1)} />
        </>
      ) : <EmptyRow text="No feedback items." />}
    </Section>
  );
}

// ─── Access Requests tab ──────────────────────────────────────────────────

const ACCESS_STATUSES = [
  { value: "", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
];

function AccessRequestsTab() {
  const [data, setData] = useState<PagedResponse<AccessRequest> | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("pending");
  const [actioning, setActioning] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await adminApi.getAccessRequests(page, 20, statusFilter || undefined);
      setData(result);
    } catch { /* keep previous */ }
    finally { setLoading(false); }
  }, [page, statusFilter]);

  useEffect(() => { load(); }, [load]);

  const decide = async (id: string, status: "approved" | "rejected") => {
    setActioning(id);
    try {
      await adminApi.decideAccessRequest(id, status);
      await load();
    } catch { /* ignore */ }
    finally { setActioning(null); }
  };

  const totalPages = data ? Math.max(1, Math.ceil(data.total / 20)) : 1;

  return (
    <Section title="Administrator Access Requests" icon={<Shield className="w-4 h-4" />}>
      <div className="px-4 py-3 border-b border-surface-800 flex gap-2">
        {ACCESS_STATUSES.map(({ value, label }) => (
          <button
            key={value}
            onClick={() => { setPage(1); setStatusFilter(value); }}
            className={cn(
              "rounded-full px-3 py-1 text-xs transition-colors",
              statusFilter === value
                ? "bg-brand-600/30 text-brand-300 border border-brand-500/30"
                : "bg-surface-800 text-surface-400 hover:text-surface-200"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? <Skeleton rows={3} /> : data?.items.length ? (
        <>
          <div className="divide-y divide-surface-800/80">
            {data.items.map((item) => (
              <div key={item.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-surface-200">{item.user_name}</p>
                    <p className="text-xs text-surface-500">{item.user_email}</p>
                    {item.reason && <p className="mt-1 text-xs text-surface-400 italic">"{item.reason}"</p>}
                  </div>
                  <StatusBadge status={item.status} />
                </div>
                {item.status === "pending" && (
                  <div className="mt-2 flex gap-2">
                    <button
                      disabled={actioning === item.id}
                      onClick={() => decide(item.id, "approved")}
                      className="rounded bg-emerald-400/10 px-2.5 py-1 text-[11px] text-emerald-200 hover:bg-emerald-400/20 disabled:opacity-40"
                    >
                      Approve
                    </button>
                    <button
                      disabled={actioning === item.id}
                      onClick={() => decide(item.id, "rejected")}
                      className="rounded bg-red-400/10 px-2.5 py-1 text-[11px] text-red-200 hover:bg-red-400/20 disabled:opacity-40"
                    >
                      Reject
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
          <Pagination page={page} totalPages={totalPages} total={data.total} onPrev={() => setPage((p) => p - 1)} onNext={() => setPage((p) => p + 1)} />
        </>
      ) : <EmptyRow text="No access requests." />}
    </Section>
  );
}

// ─── Shared UI primitives ─────────────────────────────────────────────────

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-surface-900 border border-surface-800 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-surface-800 text-sm font-medium text-surface-200">
        <span className="text-surface-400">{icon}</span>
        {title}
      </div>
      {children}
    </div>
  );
}

function EmptyRow({ text }: { text: string }) {
  return <div className="py-10 text-center text-sm text-surface-500">{text}</div>;
}

function Skeleton({ rows }: { rows: number }) {
  return (
    <div className="space-y-3 p-4">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-10 rounded bg-surface-800 animate-pulse" />
      ))}
    </div>
  );
}

function Pagination({
  page, totalPages, total,
  onPrev, onNext,
}: {
  page: number;
  totalPages: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-surface-800 text-xs text-surface-500">
      <button disabled={page === 1} onClick={onPrev} className="hover:text-cyan-300 disabled:opacity-30">
        ← Previous
      </button>
      <span>Page {page} of {totalPages} · {total} total</span>
      <button disabled={page >= totalPages} onClick={onNext} className="hover:text-cyan-300 disabled:opacity-30">
        Next →
      </button>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    open: "bg-surface-700 text-surface-300",
    in_review: "bg-amber-500/10 text-amber-300",
    solved: "bg-emerald-500/10 text-emerald-400",
    pending: "bg-amber-500/10 text-amber-300",
    approved: "bg-emerald-500/10 text-emerald-400",
    rejected: "bg-red-500/10 text-red-400",
  };
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide flex-shrink-0", styles[status] ?? "bg-surface-700 text-surface-300")}>
      {status.replace("_", " ")}
    </span>
  );
}
