"use client";

/**
 * Organization Admin dashboard.
 * Tabs: Overview · Members · Feedback · Access Requests
 */

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Users,
  FileText,
  MessageSquare,
  Zap,
  Shield,
  AlertTriangle,
  RefreshCw,
  Search,
} from "lucide-react";
import { useAuth } from "@/features/auth/AuthContext";
import { api } from "@/lib/api/client";
import { adminApi } from "@/lib/api/admin";
import type { AdminMember, FeedbackItem, AccessRequest, PagedResponse } from "@/lib/api/admin";
import { cn } from "@/lib/utils/cn";

// ─── Types ────────────────────────────────────────────────────────────────

interface OrgStats {
  total_users: number;
  total_documents: number;
  total_conversations: number;
  total_tokens_used: number;
}

interface FailedJob {
  id: string;
  document_id: string;
  document_title: string;
  status: "failed" | "dead";
  error_message: string | null;
  updated_at: string;
}

interface AdminOverview extends OrgStats {
  users: AdminMember[];
  users_page: number;
  users_page_size: number;
  failed_jobs: FailedJob[];
}

const STAT_CARDS = [
  { key: "total_users",         label: "Users",         icon: Users,         color: "text-blue-400",   bg: "bg-blue-500/10"   },
  { key: "total_documents",     label: "Documents",     icon: FileText,      color: "text-green-400",  bg: "bg-green-500/10"  },
  { key: "total_conversations", label: "Conversations", icon: MessageSquare, color: "text-purple-400", bg: "bg-purple-500/10" },
  { key: "total_tokens_used",   label: "Tokens Used",   icon: Zap,           color: "text-yellow-400", bg: "bg-yellow-500/10" },
] as const;

const TABS = ["Overview", "Members", "Feedback", "Access Requests"] as const;
type Tab = (typeof TABS)[number];

// ─── Page ─────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>("Overview");

  const isAdmin = user?.is_platform_admin || user?.organization_role === "org_admin";

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center h-full bg-surface-950">
        <div className="text-center">
          <Shield className="w-12 h-12 text-surface-600 mx-auto mb-3" />
          <h2 className="text-lg font-semibold text-white mb-1">Access Denied</h2>
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
          <h1 className="text-xl font-semibold text-white">Admin Dashboard</h1>
          <p className="text-sm text-surface-400 mt-0.5">Live organization overview and management</p>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 border-b border-surface-800">
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

        {activeTab === "Overview" && <OverviewTab />}
        {activeTab === "Members" && <MembersTab />}
        {activeTab === "Feedback" && <FeedbackTab />}
        {activeTab === "Access Requests" && <AccessRequestsTab />}
      </div>
    </div>
  );
}

// ─── Overview tab ─────────────────────────────────────────────────────────

function OverviewTab() {
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

  return (
    <div className="space-y-6">
      {error && (
        <div className="flex items-center gap-3 rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          <RefreshCw className="h-4 w-4 shrink-0 animate-spin" />
          <span>{error}</span>
        </div>
      )}
      {lastUpdated && (
        <p className="text-xs text-surface-500">Updated {lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</p>
      )}

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {STAT_CARDS.map(({ key, label, icon: Icon, color, bg }, i) => (
          <motion.div
            key={key}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.07 }}
            className="rounded-xl bg-surface-900 border border-surface-800 p-4"
          >
            <div className="flex items-center gap-3 mb-3">
              <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center", bg)}>
                <Icon className={cn("w-4 h-4", color)} />
              </div>
              <span className="text-sm text-surface-400">{label}</span>
            </div>
            {loading ? (
              <div className="h-8 w-20 bg-surface-800 animate-pulse rounded" />
            ) : (
              <p className="text-2xl font-semibold text-white">
                {stats ? Number(stats[key as keyof OrgStats]).toLocaleString() : "—"}
              </p>
            )}
          </motion.div>
        ))}
      </div>

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

// ─── Members tab ──────────────────────────────────────────────────────────

function MembersTab() {
  const [data, setData] = useState<PagedResponse<AdminMember> | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await adminApi.getMembers(page, 20, search || undefined);
      setData(result);
    } catch { /* keep previous data */ }
    finally { setLoading(false); }
  }, [page, search]);

  useEffect(() => { load(); }, [load]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    setSearch(searchInput.trim());
  };

  const totalPages = data ? Math.max(1, Math.ceil(data.total / 20)) : 1;

  return (
    <Section title="Organization Members" icon={<Users className="w-4 h-4" />}>
      <div className="px-4 py-3 border-b border-surface-800">
        <form onSubmit={handleSearch} className="flex gap-2">
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
      </div>

      {loading ? <Skeleton rows={5} /> : data?.items.length ? (
        <>
          <div className="divide-y divide-surface-800/80">
            {data.items.map((member) => (
              <div key={member.id} className="flex items-center gap-3 px-4 py-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-500/15 text-xs font-semibold text-brand-300 flex-shrink-0">
                  {member.full_name.slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-surface-200">{member.full_name}</p>
                  <p className="truncate text-xs text-surface-500">{member.email}</p>
                </div>
                <span className={cn(
                  "rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-wide flex-shrink-0",
                  member.role === "admin" ? "bg-cyan-400/10 text-cyan-300" : "bg-surface-800 text-surface-400"
                )}>
                  {member.role === "admin" ? "Admin" : "Member"}
                </span>
              </div>
            ))}
          </div>
          <Pagination page={page} totalPages={totalPages} total={data.total} onPrev={() => setPage((p) => p - 1)} onNext={() => setPage((p) => p + 1)} />
        </>
      ) : <EmptyRow text="No members found." />}
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
