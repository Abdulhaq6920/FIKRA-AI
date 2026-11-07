"use client";

/**
 * Personal analytics — the default view for every signed-in user.
 *
 * The backend scopes every metric to the caller's user ID and organization, so
 * this component can only ever show the current user's own activity. Admins
 * additionally get an organization view through `OrganizationAnalytics`.
 */

import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CalendarDays,
  Clock,
  Coins,
  FileText,
  MessageSquare,
  RefreshCw,
  ThumbsDown,
  ThumbsUp,
  Zap,
} from "lucide-react";
import { analyticsApi, type PersonalAnalytics as PersonalAnalyticsData } from "@/lib/api/analytics";
import { useCurrency } from "@/features/currency/CurrencyProvider";
import { cn } from "@/lib/utils/cn";
import {
  DailyBarChart,
  EmptyRow,
  FeedbackBadges,
  formatDateTime,
  formatLatency,
  formatNumber,
  Section,
  Skeleton,
  SourceCards,
  StatTile,
  TopSources,
} from "@/features/admin/InsightUi";

const RANGES = [
  { value: 7, label: "7 days" },
  { value: 14, label: "14 days" },
  { value: 30, label: "30 days" },
  { value: 90, label: "90 days" },
] as const;

export function RangePicker({
  days,
  onChange,
  onRefresh,
  refreshing,
}: {
  days: number;
  onChange: (days: number) => void;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5">
      {RANGES.map((range) => (
        <button
          key={range.value}
          type="button"
          onClick={() => onChange(range.value)}
          className={cn(
            "rounded-full px-2.5 py-1 text-[11px] transition-colors",
            days === range.value
              ? "bg-brand-600/30 text-brand-300 border border-brand-500/30"
              : "bg-surface-800 text-surface-400 hover:text-surface-200",
          )}
        >
          {range.label}
        </button>
      ))}
      <button
        type="button"
        onClick={onRefresh}
        disabled={refreshing}
        className="ml-1 rounded-lg border border-surface-700 p-1.5 text-surface-400 hover:text-surface-100 disabled:opacity-40"
        aria-label="Refresh analytics"
      >
        <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
      </button>
    </div>
  );
}

export function PersonalAnalytics() {
  const { format } = useCurrency();
  const [data, setData] = useState<PersonalAnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState<number>(14);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      setData(await analyticsApi.personal(days));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load your analytics.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [days]);

  useEffect(() => {
    load();
  }, [load]);

  const summary = data?.summary;
  const rangeQuestions = data?.daily.reduce((sum, point) => sum + point.questions, 0) ?? 0;
  const rangeTokens = data?.daily.reduce((sum, point) => sum + point.tokens, 0) ?? 0;
  const rangeCost = data?.daily.reduce((sum, point) => sum + (point.cost_usd ?? 0), 0) ?? 0;
  const busiestDay = data?.daily.reduce(
    (best, point) => (point.questions > best.questions ? point : best),
    data.daily[0],
  );
  const activeDays = data?.daily.filter((point) => point.questions > 0).length ?? 0;

  return (
    <div className="space-y-6">
      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          <AlertTriangle className="h-4 w-4" /> {error}
        </div>
      )}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-surface-200">My activity</h2>
          <p className="mt-0.5 text-xs text-surface-500">
            Your own questions, sources, tokens, and cost. Only you can see this data.
          </p>
        </div>
        <RangePicker
          days={days}
          onChange={setDays}
          onRefresh={load}
          refreshing={refreshing}
        />
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-brand-500/20 bg-brand-600/5 px-4 py-3 text-xs">
        <span className="inline-flex items-center gap-1.5 font-medium text-surface-200">
          <CalendarDays className="h-3.5 w-3.5 text-brand-400" /> Last {days} days
        </span>
        <span className="text-surface-400">
          <strong className="text-surface-100">{formatNumber(rangeQuestions)}</strong> questions
        </span>
        <span className="text-surface-400">
          <strong className="text-surface-100">{formatNumber(rangeTokens)}</strong> tokens
        </span>
        <span className="text-surface-400">
          <strong className="text-surface-100">{format(rangeCost)}</strong> cost
        </span>
        <span className="text-surface-400">
          <strong className="text-surface-100">{activeDays}</strong> active{" "}
          {activeDays === 1 ? "day" : "days"}
        </span>
        <span className="text-surface-400">
          Busiest day{" "}
          <strong className="text-surface-100">
            {busiestDay?.date
              ? new Date(busiestDay.date).toLocaleDateString([], {
                  month: "short",
                  day: "numeric",
                })
              : "—"}
          </strong>
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatTile
          label="Questions asked"
          value={summary?.total_questions ?? 0}
          icon={<MessageSquare className="h-4 w-4" />}
          color="text-purple-300"
          bg="bg-purple-500/10"
          hint={loading ? "Loading…" : "All-time total"}
        />
        <StatTile
          label="Conversations"
          value={summary?.total_conversations ?? 0}
          icon={<Activity className="h-4 w-4" />}
          color="text-blue-300"
          bg="bg-blue-500/10"
          hint={loading ? "Loading…" : "All-time active"}
        />
        <StatTile
          label="Tokens used"
          value={summary?.total_tokens ?? 0}
          icon={<Zap className="h-4 w-4" />}
          color="text-yellow-300"
          bg="bg-yellow-500/10"
          hint={loading ? "Loading…" : "All-time input + output"}
        />
        <StatTile
          label="Estimated cost"
          value={format(summary?.total_cost_usd ?? 0)}
          icon={<Coins className="h-4 w-4" />}
          color="text-emerald-300"
          bg="bg-emerald-500/10"
          hint={loading ? "Loading…" : "All-time spend estimate"}
        />
        <StatTile
          label="Avg answer time"
          value={formatLatency(summary?.avg_latency_ms)}
          icon={<Clock className="h-4 w-4" />}
          color="text-cyan-300"
          bg="bg-cyan-500/10"
          hint={loading ? "Loading…" : "All-time generation latency"}
        />
        <StatTile
          label="My feedback"
          value={summary?.total_feedback ?? 0}
          icon={<ThumbsUp className="h-4 w-4" />}
          color="text-rose-300"
          bg="bg-rose-500/10"
          hint={
            loading
              ? "Loading…"
              : `${formatNumber(summary?.positive_feedback ?? 0)} up · ${formatNumber(
                  summary?.negative_feedback ?? 0,
                )} down`
          }
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Section title="My questions per day" icon={<BarChart3 className="h-4 w-4" />}>
          {loading ? (
            <Skeleton rows={2} />
          ) : (
            <DailyBarChart data={data?.daily ?? []} metric="questions" />
          )}
        </Section>
        <Section title="My tokens per day" icon={<Zap className="h-4 w-4" />}>
          {loading ? (
            <Skeleton rows={2} />
          ) : (
            <DailyBarChart data={data?.daily ?? []} metric="tokens" />
          )}
        </Section>
        <Section title="My cost per day" icon={<Coins className="h-4 w-4" />}>
          {loading ? (
            <Skeleton rows={2} />
          ) : (
            <DailyBarChart data={data?.daily ?? []} metric="cost" />
          )}
        </Section>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Section title="Sources I reference most" icon={<FileText className="h-4 w-4" />}>
          {loading ? <Skeleton rows={3} /> : <TopSources sources={data?.top_sources ?? []} />}
        </Section>

        <Section title="Feedback summary" icon={<ThumbsUp className="h-4 w-4" />}>
          <div className="grid grid-cols-2 divide-x divide-surface-800">
            <div className="p-4">
              <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-surface-500">
                <ThumbsUp className="h-3 w-3 text-emerald-400" /> Positive
              </p>
              <p className="mt-1 text-2xl font-semibold text-surface-100">
                {formatNumber(summary?.positive_feedback ?? 0)}
              </p>
            </div>
            <div className="p-4">
              <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-surface-500">
                <ThumbsDown className="h-3 w-3 text-red-400" /> Negative
              </p>
              <p className="mt-1 text-2xl font-semibold text-surface-100">
                {formatNumber(summary?.negative_feedback ?? 0)}
              </p>
            </div>
          </div>
        </Section>
      </div>

      <Section
        title="My recent questions"
        icon={<MessageSquare className="h-4 w-4" />}
        action={
          <span className="text-xs text-surface-500">
            {data ? `${data.recent_questions.length} shown` : ""}
          </span>
        }
      >
        {loading ? (
          <Skeleton rows={4} />
        ) : data?.recent_questions.length ? (
          <div className="divide-y divide-surface-800/80">
            {data.recent_questions.map((question) => (
              <div key={question.id} className="px-4 py-3">
                <p className="text-sm font-medium text-surface-200">{question.question}</p>
                <p className="mt-1 text-[10px] text-surface-500">
                  {question.conversation_title} · {formatDateTime(question.asked_at)} ·{" "}
                  {formatNumber(question.input_tokens + question.output_tokens)} tokens ·{" "}
                  {format(question.cost_usd)} · {formatLatency(question.latency_ms)} ·{" "}
                  {question.model_used ?? "unknown model"}
                </p>
                {question.answer && (
                  <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-surface-300">
                    {question.answer}
                  </p>
                )}
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[10px] text-surface-500">
                    {question.sources.length} source(s)
                  </span>
                  <FeedbackBadges feedback={question.feedback} />
                </div>
                {question.sources.length > 0 && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-[11px] text-brand-300">
                      Show sources
                    </summary>
                    <SourceCards sources={question.sources} />
                  </details>
                )}
              </div>
            ))}
          </div>
        ) : (
          <EmptyRow text="You have not asked any questions yet. Start a chat to see analytics here." />
        )}
      </Section>
    </div>
  );
}
