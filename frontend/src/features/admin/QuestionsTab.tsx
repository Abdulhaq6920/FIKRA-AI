"use client";

/**
 * Admin question explorer.
 * Lists every question in the organization and opens the full flow:
 * question → retrieval → generation → feedback, with source details.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  ChevronRight,
  Clock,
  Filter,
  MessageSquare,
  Search,
  X,
  Zap,
} from "lucide-react";
import {
  adminAnalyticsApi,
  type QuestionDetail,
  type QuestionList,
} from "@/lib/api/analytics";
import { cn } from "@/lib/utils/cn";
import {
  EmptyRow,
  FeedbackBadges,
  formatDateTime,
  formatLatency,
  formatNumber,
  KeyValueGrid,
  Modal,
  Pagination,
  Section,
  Skeleton,
  SourceCards,
} from "./InsightUi";

export function QuestionsTab() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const userIdParam = searchParams.get("user");
  const userNameParam = searchParams.get("userName");

  const [data, setData] = useState<QuestionList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [userId, setUserId] = useState<string | null>(userIdParam);
  const [userName, setUserName] = useState<string | null>(userNameParam);

  const [detail, setDetail] = useState<QuestionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const detailRequest = useRef(0);

  // A member deep link from Analytics opens this tab with `?user=`. Keep the
  // filter in sync if the URL changes while the tab stays mounted.
  useEffect(() => {
    setUserId(userIdParam);
    setUserName(userNameParam);
    setPage(1);
  }, [userIdParam, userNameParam]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await adminAnalyticsApi.questions({
        page,
        page_size: 10,
        search: search || undefined,
        user_id: userId ?? undefined,
      });
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load questions.");
    } finally {
      setLoading(false);
    }
  }, [page, search, userId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSearch = (event: React.FormEvent) => {
    event.preventDefault();
    setPage(1);
    setSearch(searchInput.trim());
  };

  const clearUserFilter = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("user");
    params.delete("userName");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  };

  const openDetail = async (id: string) => {
    const request = ++detailRequest.current;
    setDetailLoading(true);
    setDetailError(null);
    setDetail(null);
    try {
      const result = await adminAnalyticsApi.question(id);
      if (request === detailRequest.current) setDetail(result);
    } catch (err) {
      if (request === detailRequest.current) {
        setDetailError(err instanceof Error ? err.message : "Could not load question.");
      }
    } finally {
      if (request === detailRequest.current) setDetailLoading(false);
    }
  };

  const totalPages = data ? Math.max(1, Math.ceil(data.total / 10)) : 1;

  // Detail overlays page through the rows already loaded in this list so
  // reading a question never navigates away from the explorer.
  const detailItems = data?.items ?? [];
  const detailIndex = detail
    ? detailItems.findIndex((item) => item.id === detail.id)
    : -1;
  const stepDetail = (delta: number) => {
    const target = detailItems[detailIndex + delta];
    if (target) void openDetail(target.id);
  };

  return (
    <>
      <Section
        title="Questions"
        icon={<MessageSquare className="w-4 h-4" />}
        action={
          <span className="text-xs text-surface-500">
            {data ? `${formatNumber(data.total)} total` : ""}
          </span>
        }
      >
        <div className="px-4 py-3 border-b border-surface-800">
          {userId && (
            <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-brand-500/30 bg-brand-600/10 px-3 py-2 text-xs">
              <Filter className="h-3.5 w-3.5 text-brand-400" />
              <span className="text-surface-200">
                Showing questions from <strong>{userName ?? "one member"}</strong>
              </span>
              <button
                type="button"
                onClick={clearUserFilter}
                className="ml-auto inline-flex items-center gap-1 rounded-full border border-surface-700 px-2 py-0.5 text-[11px] text-surface-400 transition-colors hover:text-surface-100"
              >
                <X className="h-3 w-3" /> Clear filter
              </button>
            </div>
          )}
          <form onSubmit={handleSearch} className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-surface-500" />
              <input
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Search questions or conversation titles…"
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
          {error && (
            <div className="mt-2 flex items-center gap-2 rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-200">
              <AlertTriangle className="h-3.5 w-3.5" /> {error}
            </div>
          )}
        </div>

        {loading ? (
          <Skeleton rows={6} />
        ) : data?.items.length ? (
          <>
            <div className="divide-y divide-surface-800/80">
              {data.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => openDetail(item.id)}
                  className="block w-full px-4 py-3 text-left transition-colors hover:bg-surface-800/40"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-surface-200">{item.question}</p>
                      <p className="mt-1 truncate text-xs text-surface-500">
                        {item.user_name} · {item.user_email} · {item.conversation_title}
                      </p>
                    </div>
                    <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-surface-600" />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-surface-500">
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3 w-3" /> {formatDateTime(item.asked_at)}
                    </span>
                    <span>{item.citation_count} sources</span>
                    <span>{item.feedback_count} feedback</span>
                    <span>In {formatNumber(item.input_tokens)} / Out {formatNumber(item.output_tokens)}</span>
                    <span>{formatLatency(item.latency_ms)}</span>
                  </div>
                </button>
              ))}
            </div>
            <Pagination
              page={page}
              totalPages={totalPages}
              total={data.total}
              onPrev={() => setPage((value) => Math.max(1, value - 1))}
              onNext={() => setPage((value) => value + 1)}
            />
          </>
        ) : (
          <EmptyRow
            text={
              userId
                ? "This member has no questions matching the current search."
                : search
                  ? "No questions match that search."
                  : "No questions yet."
            }
          />
        )}
      </Section>

      {(detailLoading || detail || detailError) && (
        <Modal
          title={detail ? "Question details" : "Loading question…"}
          subtitle={detail ? `${detail.user_name} · ${detail.conversation_title}` : undefined}
          onClose={() => {
            setDetail(null);
            setDetailError(null);
          }}
          onPrev={() => stepDetail(-1)}
          onNext={() => stepDetail(1)}
          prevDisabled={detailIndex <= 0}
          nextDisabled={detailIndex < 0 || detailIndex >= detailItems.length - 1}
          position={detailIndex >= 0 ? `${detailIndex + 1} of ${detailItems.length}` : undefined}
        >
          {detailLoading && <Skeleton rows={5} />}
          {detailError && <EmptyRow text={detailError} />}
          {detail && (
            <div className="divide-y divide-surface-800">
              <div className="p-4">
                <p className="text-[10px] uppercase tracking-wide text-surface-500">Question</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-surface-100">{detail.question}</p>
              </div>

              <KeyValueGrid
                items={[
                  { label: "User", value: detail.user_name },
                  { label: "Email", value: detail.user_email },
                  { label: "Conversation", value: detail.conversation_title },
                  { label: "Asked", value: formatDateTime(detail.asked_at) },
                  { label: "Answered", value: formatDateTime(detail.answered_at) },
                  { label: "Model", value: detail.model_used ?? "—" },
                  { label: "Input tokens", value: formatNumber(detail.input_tokens) },
                  { label: "Output tokens", value: formatNumber(detail.output_tokens) },
                  { label: "Latency", value: formatLatency(detail.latency_ms) },
                  { label: "Retrieval", value: formatLatency(detail.retrieval_latency_ms) },
                  { label: "Sources", value: formatNumber(detail.sources.length) },
                  { label: "Feedback", value: formatNumber(detail.feedback.length) },
                ]}
              />

              <div className="p-4">
                <p className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-surface-500">
                  <Zap className="h-3 w-3" /> Answer
                </p>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-surface-200">
                  {detail.answer ?? "No answer was recorded for this question."}
                </p>
              </div>

              <div className="p-4">
                <p className="mb-3 text-[10px] uppercase tracking-wide text-surface-500">Flow</p>
                <ol className="space-y-3">
                  {detail.flow.map((step) => (
                    <li key={step.stage} className="flex gap-3">
                      <span
                        className={cn(
                          "mt-1 h-2 w-2 shrink-0 rounded-full",
                          step.status === "complete"
                            ? "bg-emerald-400"
                            : step.status === "empty"
                              ? "bg-surface-600"
                              : step.status === "received"
                                ? "bg-cyan-400"
                                : "bg-amber-400"
                        )}
                      />
                      <div className="min-w-0">
                        <p className="text-sm text-surface-200">
                          {step.label}{" "}
                          <span className="text-[10px] uppercase text-surface-500">{step.status}</span>
                        </p>
                        {step.detail && <p className="text-xs text-surface-400">{step.detail}</p>}
                        {step.timestamp && (
                          <p className="text-[10px] text-surface-500">{formatDateTime(step.timestamp)}</p>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              </div>

              <div>
                <p className="px-4 pt-4 text-[10px] uppercase tracking-wide text-surface-500">
                  Sources ({detail.sources.length})
                </p>
                <SourceCards sources={detail.sources} />
              </div>

              <div className="p-4">
                <p className="mb-2 text-[10px] uppercase tracking-wide text-surface-500">Feedback</p>
                <FeedbackBadges feedback={detail.feedback} />
                {detail.feedback.some((item) => item.comment) && (
                  <ul className="mt-2 space-y-1">
                    {detail.feedback
                      .filter((item) => item.comment)
                      .map((item) => (
                        <li key={item.id} className="text-xs italic text-surface-400">
                          “{item.comment}”
                        </li>
                      ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
