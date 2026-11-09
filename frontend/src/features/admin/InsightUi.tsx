"use client";

/**
 * Shared presentational primitives for the analytics and admin drill-down UI.
 * CSS-only charts keep the bundle free of new charting dependencies.
 */

import { useEffect } from "react";
import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useCurrency } from "@/features/currency/CurrencyProvider";
import type {
  CitationSource,
  DailyPoint,
  QuestionFeedback,
  SourceStat,
} from "@/lib/api/analytics";

// ─── Formatting ───────────────────────────────────────────────────────────

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return Number(value).toLocaleString();
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatLatency(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return value >= 1000 ? `${(value / 1000).toFixed(2)}s` : `${Math.round(value)}ms`;
}

export function prettyStatus(value: string): string {
  return value.replace(/_/g, " ");
}

// ─── Layout primitives ────────────────────────────────────────────────────

export function Section({
  title,
  icon,
  action,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl bg-surface-900 border border-surface-800 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-surface-800 text-sm font-medium text-surface-200">
        {icon && <span className="text-surface-400">{icon}</span>}
        <span className="flex-1">{title}</span>
        {action}
      </div>
      {children}
    </div>
  );
}

export function EmptyRow({ text }: { text: string }) {
  return <div className="py-10 text-center text-sm text-surface-500">{text}</div>;
}

export function Skeleton({ rows }: { rows: number }) {
  return (
    <div className="space-y-3 p-4">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-10 rounded bg-surface-800 animate-pulse" />
      ))}
    </div>
  );
}

export function Pagination({
  page,
  totalPages,
  total,
  onPrev,
  onNext,
}: {
  page: number;
  totalPages: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-surface-800 text-xs text-surface-500">
      <button
        type="button"
        disabled={page <= 1}
        onClick={onPrev}
        className="hover:text-cyan-300 disabled:opacity-30"
      >
        ← Previous
      </button>
      <span>
        Page {page} of {totalPages} · {formatNumber(total)} total
      </span>
      <button
        type="button"
        disabled={page >= totalPages}
        onClick={onNext}
        className="hover:text-cyan-300 disabled:opacity-30"
      >
        Next →
      </button>
    </div>
  );
}

// ─── Stats + charts ───────────────────────────────────────────────────────

export function StatTile({
  label,
  value,
  hint,
  icon,
  color = "text-brand-300",
  bg = "bg-brand-500/10",
  onClick,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon?: React.ReactNode;
  color?: string;
  bg?: string;
  onClick?: () => void;
}) {
  const content = (
    <>
      <div className="flex items-center gap-3 mb-3">
        {icon && (
          <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center", bg)}>
            <span className={cn("w-4 h-4 flex items-center justify-center", color)}>{icon}</span>
          </div>
        )}
        <span className="text-sm text-surface-400">{label}</span>
      </div>
      <p className="text-2xl font-semibold text-surface-100">
        {typeof value === "number" ? formatNumber(value) : value}
      </p>
      {hint && <p className="mt-1 text-xs text-surface-500">{hint}</p>}
    </>
  );

  if (!onClick) {
    return (
      <div className="rounded-xl bg-surface-900 border border-surface-800 p-4">{content}</div>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left rounded-xl bg-surface-900 border border-surface-800 p-4 transition-colors hover:border-brand-500/40 hover:bg-surface-900/80 focus:outline-none focus:ring-1 focus:ring-brand-500"
    >
      {content}
    </button>
  );
}

export function DailyBarChart({
  data,
  metric = "questions",
}: {
  data: DailyPoint[];
  metric?: "questions" | "tokens" | "cost";
}) {
  const { currency, format } = useCurrency();
  const valueOf = (point: DailyPoint): number => {
    if (metric === "cost") return point.cost_usd ?? 0;
    return point[metric];
  };
  const disableAnimation = data.length > 60;
  const values = data.map(valueOf);
  const max = Math.max(1, ...values);
  const total = values.reduce((sum, value) => sum + value, 0);
  const label = (value: number): string => {
    if (metric === "cost") return format(value);
    return `${formatNumber(value)} ${metric}`;
  };

  return (
    <div className="px-4 py-4">
      <div className="mb-3 flex items-center justify-between text-[10px] uppercase tracking-[0.14em] text-surface-500">
        <span>
          {metric === "cost" ? `Total ${format(total)}` : `Total ${formatNumber(total)} ${metric}`}
        </span>
        <span>
          Peak {metric === "cost" ? format(max) : `${formatNumber(max)} ${metric}`}
        </span>
      </div>
      <div className="flex h-32 items-end gap-1">
        {data.map((point, index) => {
          const value = valueOf(point);
          const height = Math.max(2, Math.round((value / max) * 100));
          return (
            <motion.div
              key={point.date}
              initial={disableAnimation ? false : { height: 0 }}
              animate={{ height: `${height}%` }}
              transition={{ delay: index * 0.02, duration: 0.3 }}
              title={`${point.date}: ${label(value)}`}
              className={cn(
                "flex-1 min-w-[3px] rounded-t",
                metric === "questions" && "bg-brand-500/70",
                metric === "tokens" && "bg-cyan-500/60",
                metric === "cost" && "bg-emerald-500/70",
              )}
            />
          );
        })}
      </div>
      <div className="mt-2 flex justify-between text-[10px] text-surface-500">
        <span>{data[0]?.date ?? ""}</span>
        <span className="text-surface-400">
          {metric === "cost" ? `Cost · ${currency}` : metric}
        </span>
        <span>{data[data.length - 1]?.date ?? ""}</span>
      </div>
    </div>
  );
}

export function TopSources({ sources }: { sources: SourceStat[] }) {
  if (!sources.length) return <EmptyRow text="No cited sources yet." />;
  const max = Math.max(1, ...sources.map((source) => source.citations));
  return (
    <div className="divide-y divide-surface-800/80">
      {sources.map((source) => (
        <div key={`${source.document_id ?? source.document_title}`} className="px-4 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <p className="truncate text-sm text-surface-200">{source.document_title}</p>
            <span className="shrink-0 text-xs text-surface-400">
              {formatNumber(source.citations)} citations
            </span>
          </div>
          <div className="mt-1.5 h-1.5 rounded-full bg-surface-800">
            <div
              className="h-1.5 rounded-full bg-emerald-500/70"
              style={{ width: `${Math.round((source.citations / max) * 100)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Detail content ───────────────────────────────────────────────────────

export function FeedbackBadges({ feedback }: { feedback: QuestionFeedback[] }) {
  if (!feedback.length) {
    return <span className="text-xs text-surface-500">No feedback</span>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {feedback.map((item) => (
        <span
          key={item.id}
          className={cn(
            "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
            item.feedback_type === "thumbs_up"
              ? "bg-emerald-500/10 text-emerald-300"
              : "bg-red-500/10 text-red-300"
          )}
          title={item.comment ?? undefined}
        >
          {prettyStatus(item.feedback_type)} · {prettyStatus(item.review_status)}
        </span>
      ))}
    </div>
  );
}

export function SourceCards({ sources }: { sources: CitationSource[] }) {
  if (!sources.length) return <EmptyRow text="No sources were attached to this answer." />;
  return (
    <div className="space-y-3 p-4">
      {sources.map((source) => (
        <div
          key={`${source.source_number}-${source.chunk_id ?? source.document_id ?? source.document_title}`}
          className="rounded-lg border border-surface-800 bg-surface-950/50 p-3"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded bg-brand-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-brand-300">
              #{source.source_number}
            </span>
            <span className="text-sm font-medium text-surface-200">{source.document_title}</span>
            {source.page_number !== null && (
              <span className="text-xs text-surface-500">Page {source.page_number}</span>
            )}
            {source.section_heading && (
              <span className="truncate text-xs text-surface-500">· {source.section_heading}</span>
            )}
          </div>
          <p className="mt-2 text-xs leading-relaxed text-surface-300">{source.excerpt}</p>
          {source.chunk_content && source.chunk_content !== source.excerpt && (
            <details className="mt-2">
              <summary className="cursor-pointer text-[11px] text-brand-300">
                Show retrieved chunk
              </summary>
              <p className="mt-1 whitespace-pre-wrap rounded bg-surface-900 p-2 text-[11px] leading-relaxed text-surface-400">
                {source.chunk_content}
              </p>
            </details>
          )}
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-surface-500">
            <span>Retrieval: {source.retrieval_method ?? "unknown"}</span>
            {source.similarity !== null && (
              <span>Similarity: {(source.similarity * 100).toFixed(1)}%</span>
            )}
            {source.chunk_token_count !== null && (
              <span>Chunk tokens: {formatNumber(source.chunk_token_count)}</span>
            )}
            {source.document_original_filename && (
              <span>File: {source.document_original_filename}</span>
            )}
            {source.document_status && <span>Document: {prettyStatus(source.document_status)}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Modal ────────────────────────────────────────────────────────────────

export function Modal({
  title,
  subtitle,
  onClose,
  onPrev,
  onNext,
  prevDisabled = false,
  nextDisabled = false,
  position,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  /** Optional in-place navigation for detail overlays (e.g. previous row). */
  onPrev?: () => void;
  /** Optional in-place navigation for detail overlays (e.g. next row). */
  onNext?: () => void;
  prevDisabled?: boolean;
  nextDisabled?: boolean;
  /** Optional human-readable position, e.g. "3 of 20". */
  position?: string;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      // Arrow keys page through detail overlays without leaving the list.
      if (event.key === "ArrowLeft" && onPrev && !prevDisabled) onPrev();
      if (event.key === "ArrowRight" && onNext && !nextDisabled) onNext();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, onNext, onPrev, nextDisabled, prevDisabled]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 sm:p-8">
      <div
        className="absolute inset-0"
        onClick={onClose}
        aria-hidden="true"
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.985 }}
        animate={{ opacity: 1, scale: 1 }}
        className="relative z-10 flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-surface-700 bg-surface-900 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="flex items-start justify-between gap-4 border-b border-surface-800 px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-surface-100">{title}</h2>
            {subtitle && <p className="mt-0.5 truncate text-xs text-surface-500">{subtitle}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {position && <span className="mr-1 text-[10px] text-surface-500">{position}</span>}
            {onPrev && (
              <button
                type="button"
                onClick={onPrev}
                disabled={prevDisabled}
                className="rounded p-1 text-surface-400 hover:bg-surface-800 hover:text-surface-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-surface-400"
                aria-label="Previous item"
                title="Previous (←)"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            )}
            {onNext && (
              <button
                type="button"
                onClick={onNext}
                disabled={nextDisabled}
                className="rounded p-1 text-surface-400 hover:bg-surface-800 hover:text-surface-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-surface-400"
                aria-label="Next item"
                title="Next (→)"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded p-1 text-surface-400 hover:bg-surface-800 hover:text-surface-100"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="overflow-y-auto">{children}</div>
      </motion.div>
    </div>
  );
}

export function KeyValueGrid({
  items,
}: {
  items: Array<{ label: string; value: React.ReactNode }>;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3">
      {items.map((item) => (
        <div key={item.label}>
          <p className="text-[10px] uppercase tracking-wide text-surface-500">{item.label}</p>
          <p className="mt-0.5 text-sm text-surface-200">{item.value}</p>
        </div>
      ))}
    </div>
  );
}
