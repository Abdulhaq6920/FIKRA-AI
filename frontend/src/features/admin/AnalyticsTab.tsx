"use client";

/**
 * Organization analytics for admins.
 *
 * Deliberately different from the Overview tab: Overview owns live all-time
 * snapshot totals, while this tab owns range-scoped trends, cited sources, and
 * the member leaderboard. The user drill-down summarises a member and links to
 * the Questions tab for the full question-by-question record.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  CalendarDays,
  Clock,
  FileText,
  MessageSquare,
  Search,
  Users,
  Zap,
} from "lucide-react";
import {
  adminAnalyticsApi,
  type OrgAnalytics,
  type UserAnalyticsDetail,
  type UserAnalyticsRow,
} from "@/lib/api/analytics";
import { cn } from "@/lib/utils/cn";
import {
  DailyBarChart,
  EmptyRow,
  formatDateTime,
  formatLatency,
  formatNumber,
  Modal,
  Pagination,
  Section,
  Skeleton,
  StatTile,
  TopSources,
} from "./InsightUi";

const RANGES = [
  { value: 7, label: "7 days" },
  { value: 14, label: "14 days" },
  { value: 30, label: "30 days" },
  { value: 90, label: "90 days" },
] as const;

export function AnalyticsTab() {
  const router = useRouter();
  const [data, setData] = useState<OrgAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState<number>(14);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");

  const [selectedUser, setSelectedUser] = useState<UserAnalyticsRow | null>(null);
  const [detail, setDetail] = useState<UserAnalyticsDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const detailRequest = useRef(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(
        await adminAnalyticsApi.orgAnalytics({
          days,
          search: search || undefined,
          page,
          page_size: 20,
        })
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load analytics.");
    } finally {
      setLoading(false);
    }
  }, [days, page, search]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSearch = (event: React.FormEvent) => {
    event.preventDefault();
    setPage(1);
    setSearch(searchInput.trim());
  };

  const totalPages = data ? Math.max(1, Math.ceil(data.users.total / 20)) : 1;
  const summary = data?.summary;
  const rangeQuestions = data?.daily.reduce((sum, point) => sum + point.questions, 0) ?? 0;
  const rangeTokens = data?.daily.reduce((sum, point) => sum + point.tokens, 0) ?? 0;
  const peakDay =
    data?.daily.reduce(
      (best, point) => (point.questions > best.questions ? point : best),
      { date: "", questions: 0, tokens: 0 }
    ) ?? { date: "", questions: 0, tokens: 0 };
  const rangeDays = data?.daily.length || days;

  const openUser = async (user: UserAnalyticsRow) => {
    const request = ++detailRequest.current;
    setSelectedUser(user);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    try {
      const result = await adminAnalyticsApi.userAnalytics(user.user_id, days);
      if (request === detailRequest.current) setDetail(result);
    } catch (err) {
      if (request === detailRequest.current) {
        setDetailError(err instanceof Error ? err.message : "Could not load user analytics.");
      }
    } finally {
      if (request === detailRequest.current) setDetailLoading(false);
    }
  };

  const openUserQuestions = (user: UserAnalyticsRow) => {
    const params = new URLSearchParams({
      tab: "Questions",
      user: user.user_id,
      userName: user.full_name,
    });
    setSelectedUser(null);
    setDetail(null);
    router.push(`/admin?${params.toString()}`);
  };

  return (
    <>
      <div className="space-y-6">
        {error && (
          <div className="flex items-center gap-2 rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            <AlertTriangle className="h-4 w-4" /> {error}
          </div>
        )}

        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="flex items-center gap-1.5 text-sm font-medium text-surface-200">
              <BarChart3 className="h-4 w-4 text-brand-400" /> Activity trends
            </p>
            <p className="mt-1 text-xs text-surface-500">
              Range-scoped performance. Live organization totals stay in Overview.
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            {RANGES.map((range) => (
              <button
                key={range.value}
                type="button"
                onClick={() => {
                  setDays(range.value);
                  setPage(1);
                }}
                className={cn(
                  "rounded-full px-2.5 py-1 text-[11px] transition-colors",
                  days === range.value
                    ? "bg-brand-600/30 text-brand-300 border border-brand-500/30"
                    : "bg-surface-800 text-surface-400 hover:text-surface-200"
                )}
              >
                {range.label}
              </button>
            ))}
          </div>
        </div>

        {/* Range-scoped activity — intentionally different from the Overview snapshot. */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="Questions in range"
            value={rangeQuestions}
            icon={<MessageSquare className="h-4 w-4" />}
            color="text-purple-300"
            bg="bg-purple-500/10"
            hint={loading ? "Loading…" : `${Math.round(rangeQuestions / rangeDays)} per day`}
          />
          <StatTile
            label="Tokens in range"
            value={rangeTokens}
            icon={<Zap className="h-4 w-4" />}
            color="text-yellow-300"
            bg="bg-yellow-500/10"
            hint={loading ? "Loading…" : `Input + output · ${days} days`}
          />
          <StatTile
            label="Peak day"
            value={peakDay.questions}
            icon={<CalendarDays className="h-4 w-4" />}
            color="text-cyan-300"
            bg="bg-cyan-500/10"
            hint={
              loading
                ? "Loading…"
                : peakDay.date
                  ? new Date(peakDay.date).toLocaleDateString([], { month: "short", day: "numeric" })
                  : "No activity yet"
            }
          />
          <StatTile
            label="Avg answer time"
            value={formatLatency(summary?.avg_latency_ms)}
            icon={<Clock className="h-4 w-4" />}
            color="text-emerald-300"
            bg="bg-emerald-500/10"
            hint={loading ? "Loading…" : "All-time generation speed"}
          />
        </div>

        {/* Daily activity */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Section title="Questions per day" icon={<MessageSquare className="h-4 w-4" />}>
            {loading ? <Skeleton rows={2} /> : <DailyBarChart data={data?.daily ?? []} metric="questions" />}
          </Section>
          <Section title="Tokens per day" icon={<Zap className="h-4 w-4" />}>
            {loading ? <Skeleton rows={2} /> : <DailyBarChart data={data?.daily ?? []} metric="tokens" />}
          </Section>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Section title="Top cited sources" icon={<FileText className="h-4 w-4" />}>
            {loading ? <Skeleton rows={3} /> : <TopSources sources={data?.top_sources ?? []} />}
          </Section>

          <Section title="Member leaderboard" icon={<Users className="h-4 w-4" />}>
            <div className="px-4 py-3 border-b border-surface-800">
              <p className="mb-2 text-[10px] text-surface-500">
                Ranked by questions in the selected range. Open a member for a summary or jump straight to their questions.
              </p>
              <form onSubmit={handleSearch} className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-surface-500" />
                  <input
                    value={searchInput}
                    onChange={(event) => setSearchInput(event.target.value)}
                    placeholder="Search users…"
                    className="w-full rounded-lg bg-surface-800 border border-surface-700 pl-8 pr-3 py-1.5 text-xs text-surface-100 placeholder:text-surface-500 outline-none focus:ring-1 focus:ring-brand-500"
                  />
                </div>
                <button
                  type="submit"
                  className="rounded-lg bg-brand-600/20 border border-brand-500/30 px-3 py-1.5 text-xs text-brand-300 hover:bg-brand-600/30"
                >
                  Search
                </button>
                {search && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchInput("");
                      setSearch("");
                      setPage(1);
                    }}
                    className="rounded-lg border border-surface-700 px-3 py-1.5 text-xs text-surface-400 hover:text-surface-200"
                  >
                    Clear
                  </button>
                )}
              </form>
            </div>
            {loading ? (
              <Skeleton rows={4} />
            ) : data?.users.items.length ? (
              <div className="divide-y divide-surface-800/80">
                {data.users.items.map((row) => (
                  <button
                    key={row.user_id}
                    type="button"
                    onClick={() => openUser(row)}
                    className="block w-full px-4 py-3 text-left transition-colors hover:bg-surface-800/40"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <p className="truncate text-sm text-surface-200">{row.full_name}</p>
                          {row.is_platform_admin && (
                            <span className="rounded-full bg-cyan-400/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-cyan-300">
                              Platform
                            </span>
                          )}
                          <span
                            className={cn(
                              "rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase",
                              row.is_active
                                ? "bg-emerald-500/10 text-emerald-300"
                                : "bg-surface-800 text-surface-500"
                            )}
                          >
                            {row.is_active ? "Active" : "Inactive"}
                          </span>
                        </div>
                        <p className="truncate text-xs text-surface-500">{row.email}</p>
                      </div>
                      <div className="shrink-0 text-right text-[10px] text-surface-500">
                        <p>{formatNumber(row.questions)} questions</p>
                        <p>{formatNumber(row.tokens)} tokens</p>
                        <p>{formatLatency(row.avg_latency_ms)}</p>
                      </div>
                    </div>
                    <p className="mt-1 text-[10px] text-surface-500">
                      {formatNumber(row.conversations)} conversations · {formatNumber(row.feedback_count)} feedback ·{" "}
                      Last active {formatDateTime(row.last_active_at)}
                    </p>
                  </button>
                ))}
              </div>
            ) : (
              <EmptyRow text={search ? "No users match that search." : "No organization members."} />
            )}
            {data && data.users.total > 20 && (
              <Pagination
                page={page}
                totalPages={totalPages}
                total={data.users.total}
                onPrev={() => setPage((value) => Math.max(1, value - 1))}
                onNext={() => setPage((value) => value + 1)}
              />
            )}
          </Section>
        </div>
      </div>

      {(selectedUser || detailLoading || detailError) && (
        <Modal
          title={selectedUser ? `${selectedUser.full_name} — analytics` : "User analytics"}
          subtitle={selectedUser?.email}
          onClose={() => {
            setSelectedUser(null);
            setDetail(null);
            setDetailError(null);
          }}
        >
          {detailLoading && <Skeleton rows={5} />}
          {detailError && <EmptyRow text={detailError} />}
          {detail && (
            <div className="divide-y divide-surface-800">
              <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4">
                <DetailStat label="Questions" value={formatNumber(detail.summary.total_questions)} />
                <DetailStat label="Conversations" value={formatNumber(detail.summary.total_conversations)} />
                <DetailStat label="Tokens" value={formatNumber(detail.summary.total_tokens)} />
                <DetailStat label="Avg latency" value={formatLatency(detail.summary.avg_latency_ms)} />
                <DetailStat label="Role" value={detail.user.role} />
                <DetailStat label="Status" value={detail.user.is_active ? "Active" : "Inactive"} />
                <DetailStat label="Feedback" value={formatNumber(detail.user.feedback_count)} />
                <DetailStat label="Last active" value={formatDateTime(detail.user.last_active_at)} />
              </div>

              <Section title="Questions per day" icon={<MessageSquare className="h-4 w-4" />}>
                <DailyBarChart data={detail.daily} metric="questions" />
              </Section>

              <Section title="Top sources" icon={<FileText className="h-4 w-4" />}>
                <TopSources sources={detail.top_sources} />
              </Section>

              {/* Question-level records live in the Questions tab; linking keeps one source of truth. */}
              <div className="flex flex-wrap items-center justify-between gap-3 p-4">
                <p className="text-xs text-surface-500">
                  {formatNumber(detail.recent_questions.length)} of {formatNumber(detail.summary.total_questions)}{" "}
                  questions shown in the latest sample.
                </p>
                <button
                  type="button"
                  onClick={() => openUserQuestions(detail.user)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-brand-500/30 bg-brand-600/20 px-3 py-1.5 text-xs font-medium text-brand-300 transition-colors hover:bg-brand-600/30 focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  View {formatNumber(detail.summary.total_questions)} questions
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}

function DetailStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-surface-500">{label}</p>
      <p className="mt-0.5 text-sm text-surface-200">{value}</p>
    </div>
  );
}
