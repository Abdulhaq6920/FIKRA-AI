"use client";

/**
 * Chat page — main conversation area.
 * The conversation list is now in the AppShell sidebar.
 * This page handles: message display, streaming, citations, feedback.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowUp,
  Copy,
  FileText,
  FolderOpen,
  Link2,
  MessageSquare,
  Mic,
  MoreHorizontal,
  Plus,
  Radio,
  Settings,
  Share2,
  Sparkles,
  Square,
  Star,
  ThumbsDown,
  ThumbsUp,
  Upload,
  X,
} from "lucide-react";
import { chatApi } from "@/lib/api/chat";
import { ApiRequestError } from "@/lib/api/client";
import { cn } from "@/lib/utils/cn";
import { truncate } from "@/lib/utils/format";
import type { Message, Citation, FavoriteQuestion } from "@/types";
import { useAuth } from "@/features/auth/AuthContext";
import { MarkdownContent } from "@/features/chat/MarkdownContent";

// ─── Context bridge — AppShell needs to know about active conversation ─────
// We use a global event bus so AppShell can react to new conversations
// created from within this page.
const CONV_REFRESH_EVENT = "fikra:conv-refresh";

/** Final SSE event emitted after a streamed answer is persisted. */
interface StreamMeta {
  user_message_id: string;
  assistant_message_id: string;
  model_used: string | null;
  citations: Citation[];
}

/** User-safe labels for provider errors streamed by the backend. */
const PROVIDER_ERROR_MESSAGES: Record<string, string> = {
  PROVIDER_RATE_LIMITED:
    "The AI is handling a lot of requests right now. Please wait a few seconds and try again.",
  ProviderRateLimitError:
    "The AI is handling a lot of requests right now. Please wait a few seconds and try again.",
  PROVIDER_UNAVAILABLE:
    "The AI provider is temporarily unavailable. Please try again in a moment.",
  ProviderUnavailableError:
    "The AI provider is temporarily unavailable. Please try again in a moment.",
};

/** Collapse whitespace the same way the API does, for favourite matching. */
function normalizeQuestion(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/** Minimal Web Speech API surface — Safari/Chrome ship it under two names. */
interface SpeechRecognitionResultLike {
  readonly length: number;
  [index: number]: { transcript: string };
}
interface SpeechRecognitionEventLike {
  readonly resultIndex: number;
  readonly results: {
    readonly length: number;
    [index: number]: SpeechRecognitionResultLike;
  };
}
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
}
interface SpeechRecognitionWindow {
  SpeechRecognition?: new () => SpeechRecognitionLike;
  webkitSpeechRecognition?: new () => SpeechRecognitionLike;
}

export default function ChatPage() {
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [msgPage, setMsgPage] = useState(1);
  const [msgTotal, setMsgTotal] = useState(0);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [input, setInput] = useState("");
  const [sendingSessions, setSendingSessions] = useState<Record<string, boolean>>({});
  const [streamingSessions, setStreamingSessions] = useState<Record<string, string | null>>({});
  const [sessionErrors, setSessionErrors] = useState<Record<string, string>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  // Question that produced the last failed answer, so an error offers a
  // one-click retry instead of forcing the user to retype it.
  const [retryQuestion, setRetryQuestion] = useState<string | null>(null);
  // Optimistic bubble from the failed attempt — removed when retrying so the
  // question is not shown twice while the replacement request runs.
  const failedTempIdRef = useRef<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const activeConversationRef = useRef<string | null>(null);
  const streamControllersRef = useRef<Record<string, AbortController>>({});
  // Conversation IDs with a stream in flight (refs, not state: read inside
  // async callbacks that may outlive the render that started them).
  const streamingIdsRef = useRef<Set<string>>(new Set());
  // Completion timestamps keyed by conversation. A message fetch that started
  // before its conversation's stream finished can return stale rows; keeping
  // the local messages in that window prevents a just-arrived answer from
  // being clobbered by the stale response.
  const streamCompletedAtRef = useRef<Record<string, number>>({});
  const justLoadedEarlierRef = useRef(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();

  // ── Royal header / composer chrome ──────────────────────────────────────
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const toastTimer = useRef<number | undefined>(undefined);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  // ── Favourite questions (per user, hideable) ────────────────────────────
  const [favoritesOpen, setFavoritesOpen] = useState(false);
  const [favoriteQuestions, setFavoriteQuestions] = useState<FavoriteQuestion[]>([]);
  const [favoritesLoading, setFavoritesLoading] = useState(true);
  const favoriteSet = useMemo(
    () => new Set(favoriteQuestions.map((entry) => normalizeQuestion(entry.question))),
    [favoriteQuestions]
  );

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  }, []);

  useEffect(
    () => () => {
      window.clearTimeout(toastTimer.current);
      recognitionRef.current?.stop();
    },
    []
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOptionsOpen(false);
      setAttachOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const handleShare = useCallback(async () => {
    const url = typeof window === "undefined" ? "" : window.location.href;
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title: "FIKRA AI", url });
        return;
      } catch {
        // The user dismissed the native sheet — fall back to the clipboard.
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      showToast("Conversation link copied");
    } catch {
      showToast("Could not copy the link");
    }
  }, [showToast]);

  // Load this user's saved questions once per session and restore whether the
  // panel was left open for this browser + account.
  useEffect(() => {
    if (!user?.id) {
      setFavoriteQuestions([]);
      setFavoritesLoading(false);
      return;
    }
    let cancelled = false;
    const storageKey = `fikra-fav-questions:${user.id}`;
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored !== null) setFavoritesOpen(stored === "1");
    } catch {
      // Private browsing can deny localStorage; the panel still works.
    }
    setFavoritesLoading(true);
    chatApi
      .listFavoriteQuestions()
      .then((response) => {
        if (!cancelled) setFavoriteQuestions(response.items);
      })
      .catch(() => {
        // Non-fatal: the panel simply starts empty.
      })
      .finally(() => {
        if (!cancelled) setFavoritesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const setFavoritesVisibility = useCallback(
    (open: boolean) => {
      setFavoritesOpen(open);
      if (!user?.id) return;
      try {
        window.localStorage.setItem(
          `fikra-fav-questions:${user.id}`,
          open ? "1" : "0"
        );
      } catch {
        // Persistence is a convenience, not a requirement.
      }
    },
    [user?.id]
  );

  const saveFavorite = useCallback(
    async (question: string) => {
      const normalized = normalizeQuestion(question);
      if (!normalized) return;
      if (normalized.length > 500) {
        showToast("That question is too long to save");
        return;
      }
      if (favoriteSet.has(normalized)) {
        showToast("Already in your favourites");
        return;
      }
      try {
        const created = await chatApi.saveFavoriteQuestion(normalized);
        setFavoriteQuestions((previous) =>
          previous.some((entry) => entry.id === created.id)
            ? previous
            : [created, ...previous]
        );
        showToast("Question saved to favourites");
      } catch {
        showToast("Could not save that question");
      }
    },
    [favoriteSet, showToast]
  );

  const removeFavorite = useCallback(
    async (id: string) => {
      const removed = favoriteQuestions.find((entry) => entry.id === id);
      setFavoriteQuestions((previous) =>
        previous.filter((entry) => entry.id !== id)
      );
      try {
        await chatApi.deleteFavoriteQuestion(id);
      } catch {
        if (removed) {
          setFavoriteQuestions((previous) =>
            previous.some((entry) => entry.id === removed.id)
              ? previous
              : [removed, ...previous]
          );
        }
        showToast("Could not remove that question");
      }
    },
    [favoriteQuestions, showToast]
  );

  const useFavoriteQuestion = useCallback((question: string) => {
    setInput(question);
    // Focus after the textarea has received the new value so the caret lands
    // at the end, ready to edit or send.
    requestAnimationFrame(() => {
      const element = textareaRef.current;
      element?.focus();
      element?.setSelectionRange(question.length, question.length);
    });
  }, []);

  const handleVoice = useCallback(() => {
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }
    const speechWindow = window as unknown as SpeechRecognitionWindow;
    const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Recognition) {
      showToast("Voice input is not available in this browser");
      return;
    }

    const baseInput = input.trim();
    const recognition = new Recognition();
    recognition.lang = navigator.language || "en-US";
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      let transcript = "";
      for (let index = 0; index < event.results.length; index += 1) {
        transcript += event.results[index][0]?.transcript ?? "";
      }
      setInput(`${baseInput ? `${baseInput} ` : ""}${transcript}`.trim());
    };
    recognition.onerror = () => {
      setListening(false);
      showToast("Could not hear that — please try again");
    };
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
    showToast("Listening… speak your question");
  }, [input, listening, showToast]);

  const MSG_PAGE_SIZE = 30;

  useEffect(() => {
    const conversationId = searchParams.get("conversation");
    activeConversationRef.current = conversationId;
    setActiveConvId(conversationId);
    setMessages([]);
    setMsgTotal(0);
    setMsgPage(1);
    setGeneralError(null);
  }, [searchParams]);

  const setSessionError = useCallback((conversationId: string, message: string | null) => {
    setSessionErrors((previous) => {
      const next = { ...previous };
      if (message) next[conversationId] = message;
      else delete next[conversationId];
      return next;
    });
  }, []);

  // Load the most recent page of messages when conversation changes
  useEffect(() => {
    if (!activeConvId) {
      setMessages([]);
      setMsgTotal(0);
      setMsgPage(1);
      return;
    }
    const targetId = activeConvId;
    const fetchStartedAt = Date.now();
    let cancelled = false;
    setLoadingMsgs(true);
    chatApi
      .getMessages(targetId, 1, MSG_PAGE_SIZE)
      .then((res) => {
        if (cancelled) return;
        setMessages((prev) => {
          // If this conversation is still streaming, or its stream finished
          // while this request was in flight, the server snapshot may predate
          // the answer that just rendered. Merge the local rows back in by ID
          // so the partial/full answer is never dropped or duplicated.
          const streamBusy = streamingIdsRef.current.has(targetId);
          const finishedDuringFetch =
            (streamCompletedAtRef.current[targetId] ?? 0) >= fetchStartedAt;
          if (!streamBusy && !finishedDuringFetch) return res.items;

          const seen = new Set(res.items.map((msg) => msg.id));
          const localOnly = prev.filter((msg) => !seen.has(msg.id));
          return localOnly.length ? [...res.items, ...localOnly] : res.items;
        });
        setMsgTotal(res.total);
        setMsgPage(Math.max(1, res.page));
      })
      .catch(() => {
        if (!cancelled) setMessages([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingMsgs(false);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConvId]);

  // Older history pages prepend above the current window; the scroll anchor
  // is preserved so the view does not jump while reading a long thread.
  const loadEarlierMessages = useCallback(async () => {
    if (!activeConvId || loadingEarlier || loadingMsgs) return;
    setLoadingEarlier(true);
    const container = scrollRef.current;
    const prevHeight = container?.scrollHeight ?? 0;
    try {
      const res = await chatApi.getMessages(activeConvId, msgPage + 1, MSG_PAGE_SIZE);
      if (res.items.length) {
        setMessages((prev) => {
          const seen = new Set(prev.map((msg) => msg.id));
          const older = res.items.filter((msg) => !seen.has(msg.id));
          return [...older, ...prev];
        });
        setMsgPage(res.page ?? msgPage + 1);
        setMsgTotal(res.total);
        if (container) {
          justLoadedEarlierRef.current = true;
          requestAnimationFrame(() => {
            if (container) container.scrollTop = container.scrollHeight - prevHeight;
          });
        }
      }
    } catch {
      setSessionError(activeConvId, "Could not load earlier messages. Please try again.");
    } finally {
      setLoadingEarlier(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConvId, loadingEarlier, loadingMsgs, msgPage]);

  // Scroll to bottom — never when history pages were just prepended
  useEffect(() => {
    if (justLoadedEarlierRef.current) {
      justLoadedEarlierRef.current = false;
      return;
    }
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, activeConvId, streamingSessions]);

  // Expose conversation selection to AppShell via window events
  useEffect(() => {
    const handler = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      setActiveConvId(id);
    };
    window.addEventListener("fikra:select-conv", handler);
    return () => window.removeEventListener("fikra:select-conv", handler);
  }, []);

  // A conversation deleted from the sidebar must vanish completely: abort its
  // in-flight stream, drop all per-session UI state, and if it was the open
  // one reset to a brand-new empty session (the sidebar also re-routes away).
  useEffect(() => {
    const handler = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;

      streamControllersRef.current[id]?.abort();
      delete streamControllersRef.current[id];
      streamingIdsRef.current.delete(id);
      delete streamCompletedAtRef.current[id];
      window.dispatchEvent(
        new CustomEvent("fikra:stream-state", {
          detail: { conversationId: id, active: false },
        })
      );

      setSendingSessions((prev) => {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setStreamingSessions((prev) => {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setSessionErrors((prev) => {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });

      if (activeConversationRef.current === id) {
        activeConversationRef.current = null;
        setActiveConvId(null);
        setMessages([]);
        setMsgTotal(0);
        setMsgPage(1);
        setGeneralError(null);
      }
    };
    window.addEventListener("fikra:conv-deleted", handler);
    return () => window.removeEventListener("fikra:conv-deleted", handler);
  }, []);

  const handleSend = async (override?: string) => {
    const question = (override ?? input).trim();
    if (!question || (activeConvId && sendingSessions[activeConvId])) return;

    let convId = activeConvId;
    if (!convId) {
      try {
        const conv = await chatApi.createConversation(truncate(question, 60));
        activeConversationRef.current = conv.id;
        setActiveConvId(conv.id);
        convId = conv.id;
        router.push(`/chat?conversation=${conv.id}`);
        window.dispatchEvent(new CustomEvent(CONV_REFRESH_EVENT));
      } catch {
        setGeneralError("Failed to start conversation.");
        setRetryQuestion(question);
        return;
      }
    }

    if (!override) setInput("");
    setRetryQuestion(null);
    if (failedTempIdRef.current) {
      const failedId = failedTempIdRef.current;
      failedTempIdRef.current = null;
      setMessages((prev) => prev.filter((msg) => msg.id !== failedId));
    }
    setSendingSessions((previous) => ({ ...previous, [convId]: true }));
    setSessionError(convId, null);
    streamingIdsRef.current.add(convId);
    window.dispatchEvent(
      new CustomEvent("fikra:stream-state", {
        detail: { conversationId: convId, active: true },
      })
    );

    // Optimistic user message
    const tempMsg: Message = {
      id: `temp-${Date.now()}`,
      role: "user",
      content: question,
      citations: null,
      model_used: null,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempMsg]);

    try {
      const controller = new AbortController();
      streamControllersRef.current[convId] = controller;
      const stream = await chatApi.askStream(question, convId, controller.signal);
      const reader = stream.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";
      let eventBuffer = "";
      let meta: StreamMeta | null = null;
      let streamFailed = false;
      setStreamingSessions((previous) => ({ ...previous, [convId]: "" }));

      const processEvents = () => {
        const events = eventBuffer.split("\n\n");
        eventBuffer = events.pop() ?? "";

        for (const event of events) {
          const data = event
            .split("\n")
            .filter((line) => line.startsWith("data: "))
            .map((line) => line.slice(6))
            .join("\n");
          if (!data || data === "[DONE]") continue;

          try {
            const payload = JSON.parse(data) as {
              text?: string;
              error?: string;
              message?: string;
              meta?: StreamMeta;
            };
            if (payload.error) {
              streamFailed = true;
              setSessionError(
                convId,
                payload.message ??
                  PROVIDER_ERROR_MESSAGES[payload.error] ??
                  "The AI provider encountered an error. Please try again."
              );
              continue;
            }
            if (payload.meta) meta = payload.meta;
            if (payload.text) {
              accumulated += payload.text;
              setStreamingSessions((previous) => ({ ...previous, [convId]: accumulated }));
            }
          } catch {
            setSessionError(convId, "The AI response could not be read. Please try again.");
          }
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        eventBuffer += decoder.decode(value, { stream: true });
        processEvents();
      }
      eventBuffer += decoder.decode();
      processEvents();

      if (!streamFailed && !controller.signal.aborted) {
        // `meta` is only assigned inside the event-parsing closure, so TS
        // narrows it to its initial `null`; assert the declared union back.
        const finalMeta = meta as StreamMeta | null;
        // The server persisted the exchange just before sending `meta`, so
        // this timestamp lets an in-flight message fetch know its snapshot
        // may be stale.
        streamCompletedAtRef.current[convId] = Date.now();

        if (activeConversationRef.current === convId) {
          const assistantId = finalMeta?.assistant_message_id ?? `stream-${Date.now()}`;
          setMessages((previous) => {
            const mapped = previous.map((msg) =>
              finalMeta && msg.id === tempMsg.id
                ? { ...msg, id: finalMeta.user_message_id }
                : msg
            );
            // A late-arriving fetch may already include this exact message.
            if (mapped.some((msg) => msg.id === assistantId)) return mapped;
            return [
              ...mapped,
              {
                id: assistantId,
                role: "assistant",
                content: accumulated,
                citations: finalMeta?.citations ?? null,
                model_used: finalMeta?.model_used ?? null,
                created_at: new Date().toISOString(),
              },
            ];
          });
        }
      } else if (streamFailed) {
        failedTempIdRef.current = tempMsg.id;
        setRetryQuestion(question);
      }
      setStreamingSessions((previous) => ({ ...previous, [convId]: null }));
      window.dispatchEvent(new CustomEvent(CONV_REFRESH_EVENT));
    } catch (err) {
      setStreamingSessions((previous) => ({ ...previous, [convId]: null }));
      if (err instanceof DOMException && err.name === "AbortError") return;
      failedTempIdRef.current = tempMsg.id;
      setRetryQuestion(question);
      if (err instanceof ApiRequestError) {
        setSessionError(convId, err.message);
      } else {
        setSessionError(convId, "Something went wrong. Please try again.");
      }
    } finally {
      delete streamControllersRef.current[convId];
      streamingIdsRef.current.delete(convId);
      window.dispatchEvent(
        new CustomEvent("fikra:stream-state", {
          detail: { conversationId: convId, active: false },
        })
      );
      setSendingSessions((previous) => ({ ...previous, [convId]: false }));
    }
  };

  const error = activeConvId ? sessionErrors[activeConvId] ?? null : generalError;
  const sending = activeConvId ? Boolean(sendingSessions[activeConvId]) : false;
  const streamingText = activeConvId ? streamingSessions[activeConvId] ?? null : null;

  const handleStop = useCallback(() => {
    const id = activeConversationRef.current;
    if (!id) return;
    // Abort the fetch (closes the ReadableStream on the client side)
    streamControllersRef.current[id]?.abort();
    // Also signal the server to stop yielding chunks
    chatApi.cancelStream("", id).catch(() => {});
  }, []);

  // Escape stops an in-flight answer, matching the composer's stop button.
  useEffect(() => {
    if (!sending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        handleStop();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sending, handleStop]);

  // Leaving the chat page cancels nothing on the server (answers are persisted
  // there), but the sidebar's streaming dots must not stay lit afterwards.
  useEffect(
    () => () => {
      streamingIdsRef.current.forEach((id) => {
        window.dispatchEvent(
          new CustomEvent("fikra:stream-state", {
            detail: { conversationId: id, active: false },
          })
        );
      });
    },
    []
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const handleFeedback = useCallback(
    async (messageId: string, type: "thumbs_up" | "thumbs_down") => {
      const comment =
        type === "thumbs_down"
          ? window.prompt("What should we improve about this answer?")?.trim()
          : undefined;
      if (type === "thumbs_down" && !comment) return;
      await chatApi.submitFeedback(messageId, type, comment).catch(() => {});
    },
    []
  );

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-surface-950">
      {/* Warm ambient stage — amber, bronze and royal indigo under heavy blur. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="chat-orb chat-orb-amber -left-32 -top-32 h-[26rem] w-[26rem]" />
        <div className="chat-orb chat-orb-indigo -right-28 top-6 h-[24rem] w-[24rem]" />
        <div className="chat-orb chat-orb-bronze -bottom-40 left-[28%] h-[24rem] w-[24rem]" />
        <div className="cyber-grid absolute inset-0 opacity-20" />
      </div>

      <header className="relative z-20 flex h-[72px] flex-shrink-0 items-center justify-between gap-2 px-3 sm:px-6 md:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <div className="glass-chip flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl shadow-[0_0_28px_rgb(var(--brand-500)/0.16)]">
            <Sparkles className="h-[18px] w-[18px] text-brand-300" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-[9px] font-semibold uppercase tracking-[0.24em] text-surface-400 sm:text-[10px]">
              Royal knowledge assistant
            </p>
            <h1 className="truncate text-[15px] font-semibold tracking-tight text-surface-50 sm:text-base">
              FIKRA AI
            </h1>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
          <PillButton
            label="Favourites"
            onClick={() => setFavoritesVisibility(!favoritesOpen)}
            active={favoritesOpen}
            pressed={favoritesOpen}
            expanded={favoritesOpen}
          >
            <Star
              className={cn("h-4 w-4", favoritesOpen && "fill-current")}
              aria-hidden="true"
            />
          </PillButton>
          <PillButton label="Share" onClick={() => void handleShare()}>
            <Share2 className="h-4 w-4" aria-hidden="true" />
          </PillButton>
          <div className="relative">
            <PillButton
              label="Options"
              onClick={() => {
                setOptionsOpen((value) => !value);
                setAttachOpen(false);
              }}
              expanded={optionsOpen}
              active={optionsOpen}
            >
              <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
            </PillButton>
            <AnimatePresence>
              {optionsOpen && (
                <motion.div
                  key="chat-options"
                  role="menu"
                  aria-label="Conversation options"
                  initial={{ opacity: 0, scale: 0.97 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  transition={{ duration: 0.16, ease: "easeOut" }}
                  className="glass-surface absolute right-0 top-[calc(100%+8px)] z-40 w-56 rounded-2xl p-1.5 shadow-2xl"
                >
                  <MenuButton
                    icon={<MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />}
                    onClick={() => {
                      setOptionsOpen(false);
                      router.push("/chat");
                    }}
                  >
                    New conversation
                  </MenuButton>
                  <MenuButton
                    icon={<Link2 className="h-3.5 w-3.5" aria-hidden="true" />}
                    onClick={() => {
                      setOptionsOpen(false);
                      void handleShare();
                    }}
                  >
                    Copy conversation link
                  </MenuButton>
                  <MenuButton
                    icon={<Settings className="h-3.5 w-3.5" aria-hidden="true" />}
                    onClick={() => {
                      setOptionsOpen(false);
                      router.push("/settings");
                    }}
                  >
                    Appearance &amp; settings
                  </MenuButton>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </header>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="relative z-10 flex-1 overflow-y-auto px-3 pb-4 pt-2 sm:px-6 md:px-8"
      >
        <div className="mx-auto w-full max-w-3xl space-y-5">
          {!activeConvId && !loadingMsgs && messages.length === 0 && (
            <EmptyState
              name={user?.full_name}
              onPick={(prompt) => {
                setInput(prompt);
                requestAnimationFrame(() => {
                  const el = textareaRef.current;
                  if (!el) return;
                  el.focus();
                  el.setSelectionRange(prompt.length, prompt.length);
                });
              }}
            />
          )}

          {loadingMsgs && <MessagesSkeleton />}

          {!loadingMsgs && activeConvId && messages.length < msgTotal && (
            <div className="flex justify-center">
              <button
                type="button"
                onClick={loadEarlierMessages}
                disabled={loadingEarlier}
                className="glass-chip rounded-full px-4 py-1.5 text-xs text-surface-300 transition-colors hover:text-surface-100 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                {loadingEarlier
                  ? "Loading earlier messages…"
                  : `Load earlier messages · ${msgTotal - messages.length} older`}
              </button>
            </div>
          )}

          {messages.map((msg) => (
            <MessageBubble
              key={msg.id}
              message={msg}
              onFeedback={handleFeedback}
              isFavorite={
                msg.role === "user" && favoriteSet.has(normalizeQuestion(msg.content))
              }
              onSaveFavorite={saveFavorite}
            />
          ))}

          {sending && streamingText === null && <SseLoadingIndicator />}

          {streamingText !== null && <StreamingBubble text={streamingText} />}

          {error && (
            <div className="flex flex-col items-center gap-2">
              <div className="glass-surface max-w-xl rounded-2xl border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                {error}
              </div>
              {retryQuestion && !sending && (
                <button
                  type="button"
                  onClick={() => void handleSend(retryQuestion)}
                  className="rounded-full border border-red-400/40 bg-red-500/10 px-4 py-1.5 text-xs font-medium text-red-300 transition-colors hover:bg-red-500/20 hover:text-red-200 focus:outline-none focus:ring-2 focus:ring-red-400"
                >
                  Retry
                </button>
              )}
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Composer */}
      <div className="relative z-20 flex-shrink-0 px-3 pb-3 sm:px-6 sm:pb-5">
        <div className="mx-auto w-full max-w-3xl">
          <AnimatePresence initial={false}>
            {favoritesOpen && (
              <FavoritesPanel
                key="favorites-panel"
                questions={favoriteQuestions}
                loading={favoritesLoading}
                onUse={useFavoriteQuestion}
                onRemove={(id) => void removeFavorite(id)}
                onClose={() => setFavoritesVisibility(false)}
              />
            )}
          </AnimatePresence>

          <div className="relative">
            <AnimatePresence>
              {attachOpen && (
                <motion.div
                  key="attach-menu"
                  role="menu"
                  aria-label="Add documents"
                  initial={{ opacity: 0, y: 6, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 4, scale: 0.98 }}
                  transition={{ duration: 0.16, ease: "easeOut" }}
                  className="glass-surface absolute bottom-[calc(100%+10px)] left-0 z-40 w-64 rounded-2xl p-1.5 shadow-2xl"
                >
                  <MenuButton
                    icon={<FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />}
                    onClick={() => {
                      setAttachOpen(false);
                      router.push("/documents");
                    }}
                  >
                    Browse knowledge base
                  </MenuButton>
                  <MenuButton
                    icon={<Upload className="h-3.5 w-3.5" aria-hidden="true" />}
                    onClick={() => {
                      setAttachOpen(false);
                      router.push("/admin?tab=Documents");
                    }}
                  >
                    Upload documents
                  </MenuButton>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="glass-composer flex items-end gap-1.5 rounded-[30px] px-2 py-2 sm:gap-2 sm:px-3 sm:py-2.5">
              <button
                type="button"
                onClick={() => {
                  setAttachOpen((value) => !value);
                  setOptionsOpen(false);
                }}
                aria-label="Add documents"
                aria-expanded={attachOpen}
                title="Add documents"
                className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-surface-300 transition-colors hover:bg-surface-100/10 hover:text-surface-100 focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
              </button>

              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  activeConvId
                    ? "Ask about your documents…"
                    : "Start a new conversation…"
                }
                rows={1}
                className="max-h-36 flex-1 resize-none bg-transparent px-1 py-2.5 text-sm text-surface-100 outline-none placeholder:text-surface-500"
                aria-label="Chat input"
                style={{ lineHeight: "1.5" }}
                onInput={(e) => {
                  const el = e.currentTarget;
                  el.style.height = "auto";
                  el.style.height = `${Math.min(el.scrollHeight, 144)}px`;
                }}
              />

              <button
                type="button"
                onClick={handleVoice}
                aria-label={listening ? "Stop voice input" : "Start voice input"}
                aria-pressed={listening}
                title={listening ? "Stop voice input" : "Voice input"}
                className={cn(
                  "flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500",
                  listening
                    ? "bg-brand-500/25 text-brand-200"
                    : "text-surface-300 hover:bg-surface-100/10 hover:text-surface-100"
                )}
              >
                <Mic
                  className={cn("h-4 w-4", listening && "animate-pulse")}
                  aria-hidden="true"
                />
              </button>

              <button
                onClick={sending ? handleStop : () => void handleSend()}
                disabled={sending ? false : !input.trim()}
                title={sending ? "Stop response (Esc)" : "Send message (Enter)"}
                aria-keyshortcuts={sending ? "Escape" : undefined}
                className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-200 via-brand-400 to-brand-600 text-[#1b1405] shadow-[0_0_26px_rgb(var(--brand-500)/0.35)] transition-all hover:scale-105 disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-brand-300"
                aria-label={sending ? "Stop response" : "Send message"}
              >
                {sending ? (
                  <Square className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                ) : (
                  <ArrowUp className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
            </div>
          </div>
          <p className="mt-2 flex items-center justify-center gap-1.5 text-[11px] text-surface-500">
            <Sparkles className="h-3 w-3 text-brand-300" aria-hidden="true" />
            Grounded in your organisation’s indexed documents.
          </p>
        </div>
      </div>

      {/* Lightweight confirmations for header and composer actions. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-[8.5rem] z-40 flex justify-center px-4">
        <AnimatePresence>
          {toast && (
            <motion.div
              key={toast}
              role="status"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              transition={{ duration: 0.18 }}
              className="glass-surface rounded-full px-4 py-2 text-xs font-medium text-surface-200 shadow-xl"
            >
              {toast}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function SseLoadingIndicator() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="mx-auto flex max-w-3xl items-center gap-3 px-3 py-2 text-xs text-surface-400"
    >
      <span className="flex gap-1" aria-label="Preparing response">
        <span className="sse-dot" />
        <span className="sse-dot [animation-delay:160ms]" />
        <span className="sse-dot [animation-delay:320ms]" />
      </span>
      <span>Weaving insights</span>
    </motion.div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

const MessageBubble = memo(function MessageBubble({
  message,
  onFeedback,
  isFavorite,
  onSaveFavorite,
}: {
  message: Message;
  onFeedback: (id: string, type: "thumbs_up" | "thumbs_down") => void;
  isFavorite: boolean;
  onSaveFavorite: (question: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const isUser = message.role === "user";

  const handleCopy = async () => {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className={cn(
        "flex items-end gap-2.5",
        isUser ? "justify-end" : "justify-start"
      )}
    >
      {!isUser && <AssistantAvatar />}
      <div
        className={cn(
          "min-w-0",
          isUser ? "max-w-[86%] sm:max-w-[78%]" : "max-w-[93%] sm:max-w-[86%]"
        )}
      >
        <div
          className={cn(
            "px-4 py-3.5 text-[13.5px] leading-relaxed sm:px-5 sm:py-4 sm:text-sm",
            isUser
              ? "bubble-user rounded-[24px] rounded-br-[8px] text-surface-100"
              : "bubble-ai rounded-[24px] rounded-tl-[8px] text-surface-100"
          )}
        >
          {isUser ? (
            <p className="whitespace-pre-wrap">{message.content}</p>
          ) : (
            <MarkdownContent content={message.content} />
          )}
        </div>

        {isUser && (
          <div className="mt-1 flex justify-end pr-1">
            <button
              type="button"
              onClick={() => onSaveFavorite(message.content)}
              disabled={isFavorite}
              aria-label={isFavorite ? "Question saved" : "Save question to favourites"}
              title={isFavorite ? "Saved to favourites" : "Save question to favourites"}
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500/40",
                isFavorite
                  ? "text-brand-300"
                  : "text-surface-500 hover:bg-surface-100/5 hover:text-surface-200"
              )}
            >
              <Star
                className={cn("h-3 w-3", isFavorite && "fill-current")}
                aria-hidden="true"
              />
              {isFavorite ? "Saved" : "Save question"}
            </button>
          </div>
        )}

        {!isUser && message.citations && message.citations.length > 0 && (
          <CitationList citations={message.citations} />
        )}

        {!isUser && (
          <div className="mt-1.5 flex items-center gap-0.5 pl-0.5">
            <button
              onClick={() => void handleCopy()}
              className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] text-surface-500 transition-colors hover:bg-surface-100/5 hover:text-surface-200 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
              aria-label="Copy answer"
            >
              <Copy className="h-3 w-3" aria-hidden="true" />
              {copied ? "Copied!" : "Copy"}
            </button>
            <button
              onClick={() => onFeedback(message.id, "thumbs_up")}
              className="rounded-full p-1.5 text-surface-500 transition-colors hover:bg-emerald-400/10 hover:text-emerald-300 focus:outline-none focus:ring-2 focus:ring-emerald-400/40"
              aria-label="Good response"
            >
              <ThumbsUp className="h-3 w-3" aria-hidden="true" />
            </button>
            <button
              onClick={() => onFeedback(message.id, "thumbs_down")}
              className="rounded-full p-1.5 text-surface-500 transition-colors hover:bg-red-400/10 hover:text-red-300 focus:outline-none focus:ring-2 focus:ring-red-400/40"
              aria-label="Bad response"
            >
              <ThumbsDown className="h-3 w-3" aria-hidden="true" />
            </button>
            {message.model_used && (
              <span className="ml-1 truncate text-[9px] uppercase tracking-[0.12em] text-surface-600">
                {message.model_used}
              </span>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
});

function FavoritesPanel({
  questions,
  loading,
  onUse,
  onRemove,
  onClose,
}: {
  questions: FavoriteQuestion[];
  loading: boolean;
  onUse: (question: string) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, height: 0, y: 8 }}
      animate={{ opacity: 1, height: "auto", y: 0 }}
      exit={{ opacity: 0, height: 0, y: 6 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      className="overflow-hidden"
      aria-label="Favourite questions"
    >
      <div className="glass-surface mb-2 rounded-2xl px-3 py-2.5">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-surface-400">
            <Star className="h-3 w-3 text-brand-300" aria-hidden="true" />
            Favourite questions
            {questions.length > 0 && (
              <span className="rounded-full bg-brand-500/15 px-1.5 py-0.5 text-[9px] font-bold text-brand-200">
                {questions.length}
              </span>
            )}
          </p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Hide favourite questions"
            title="Hide favourites"
            className="rounded-full p-1 text-surface-500 transition-colors hover:bg-surface-100/10 hover:text-surface-200 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>

        {loading ? (
          <div className="flex gap-1.5" aria-label="Loading favourite questions">
            {[1, 2, 3].map((index) => (
              <span
                key={index}
                className="h-6 w-28 animate-pulse rounded-full bg-surface-100/5"
              />
            ))}
          </div>
        ) : questions.length > 0 ? (
          <div className="flex max-h-28 flex-wrap items-start gap-1.5 overflow-y-auto pr-1">
            {questions.map((entry) => (
              <span
                key={entry.id}
                className="glass-chip inline-flex max-w-full items-center rounded-full py-1 pl-3 pr-1"
              >
                <button
                  type="button"
                  onClick={() => onUse(entry.question)}
                  title={entry.question}
                  className="max-w-[17rem] truncate text-left text-[11px] text-surface-300 transition-colors hover:text-surface-100 focus:outline-none focus:ring-2 focus:ring-brand-500/40 sm:max-w-[22rem]"
                >
                  {entry.question}
                </button>
                <button
                  type="button"
                  onClick={() => onRemove(entry.id)}
                  aria-label={`Remove favourite: ${entry.question}`}
                  title="Remove favourite"
                  className="ml-1 rounded-full p-0.5 text-surface-500 transition-colors hover:bg-red-400/10 hover:text-red-300 focus:outline-none focus:ring-2 focus:ring-red-400/40"
                >
                  <X className="h-2.5 w-2.5" aria-hidden="true" />
                </button>
              </span>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-surface-500">
            No saved questions yet. Tap{" "}
            <span className="font-medium text-surface-300">Save question</span>{" "}
            under any message you send to keep it here.
          </p>
        )}
      </div>
    </motion.section>
  );
}

function AssistantAvatar() {
  return (
    <span
      className="glass-chip mb-1 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-brand-300"
      aria-hidden="true"
    >
      <Sparkles className="h-3.5 w-3.5" />
    </span>
  );
}

/** A document title that is actually a domain earns a real favicon. */
function citationDomain(title: string): string | null {
  const trimmed = title.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  const match = trimmed.match(
    /^(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)/i
  );
  if (!match) return null;
  const host = match[1].toLowerCase();
  return /\.(com|org|net|io|ai|co|gov|edu|dev|app|info|biz|xyz|me|tv)$/.test(host)
    ? host
    : null;
}

function CitationFavicon({ title }: { title: string }) {
  const [failed, setFailed] = useState(false);
  const domain = citationDomain(title);
  if (!domain || failed) {
    return <FileText className="h-2.5 w-2.5 text-brand-300" aria-hidden="true" />;
  }
  return (
    // Favicons are decorative; the chip label carries the document name.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`}
      alt=""
      width={12}
      height={12}
      loading="lazy"
      className="h-3 w-3 rounded-[3px]"
      onError={() => setFailed(true)}
    />
  );
}

function CitationList({ citations }: { citations: Citation[] }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-1" aria-label="Sources">
      <span className="text-[9px] font-semibold uppercase tracking-[0.16em] text-surface-600">
        Sources
      </span>
      {citations.map((citation) => (
        <span
          key={`${citation.document_id}-${citation.source_number}`}
          title={`${citation.document_title}${
            citation.page_number ? ` · page ${citation.page_number}` : ""
          }\n${citation.excerpt}`}
          className="glass-chip inline-flex max-w-[16rem] items-center gap-1.5 rounded-full px-2.5 py-1 text-[10.5px] text-surface-300"
        >
          <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-100/10">
            <CitationFavicon title={citation.document_title} />
          </span>
          <span className="truncate">{citation.document_title}</span>
          {citation.page_number && (
            <span className="flex-shrink-0 text-[9px] text-surface-500">
              p.{citation.page_number}
            </span>
          )}
          <span className="flex-shrink-0 rounded-full bg-brand-500/10 px-1 text-[8px] font-semibold text-brand-300">
            {citation.source_number}
          </span>
        </span>
      ))}
    </div>
  );
}

function StreamingBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-start items-end gap-2.5">
      <AssistantAvatar />
      <div className="bubble-ai max-w-[93%] rounded-[24px] rounded-tl-[8px] px-4 py-4 text-sm text-surface-100 sm:max-w-[86%] sm:px-5">
        <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-300/80">
          <Radio className="h-3 w-3 animate-pulse" aria-hidden="true" />
          Synthesizing answer
        </div>
        <MarkdownContent content={text} streaming />
      </div>
    </div>
  );
}

function PillButton({
  label,
  onClick,
  active = false,
  pressed,
  expanded,
  children,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  pressed?: boolean;
  expanded?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={pressed}
      aria-expanded={expanded}
      title={label}
      className={cn(
        "glass-chip flex h-10 items-center justify-center rounded-full px-2.5 text-surface-300 transition-all hover:-translate-y-px hover:text-surface-100 focus:outline-none focus:ring-2 focus:ring-brand-500/50 sm:px-3",
        active && "border-brand-400/40 text-brand-200"
      )}
    >
      {children}
      <span className="ml-1.5 hidden text-[11px] font-medium lg:inline">{label}</span>
    </button>
  );
}

function MenuButton({
  icon,
  onClick,
  children,
}: {
  icon: React.ReactNode;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-xs text-surface-200 transition-colors hover:bg-surface-100/10 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
    >
      {icon}
      <span>{children}</span>
    </button>
  );
}

const STARTER_PROMPTS = [
  "Summarize the key points across our documents",
  "What is our onboarding process?",
  "Find the latest policy updates",
  "Which documents cover compliance?",
] as const;

function EmptyState({
  name,
  onPick,
}: {
  name?: string;
  onPick: (prompt: string) => void;
}) {
  return (
    <div className="relative flex min-h-[58vh] w-full items-center justify-center py-6 sm:py-10">
      <div className="glass-surface relative w-full max-w-xl rounded-[28px] p-6 text-center sm:p-8">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-brand-400/30 bg-brand-500/10 shadow-[0_0_32px_rgb(var(--brand-500)/0.18)]">
          <Sparkles className="h-6 w-6 text-brand-300" aria-hidden="true" />
        </div>
        <h2 className="mb-1 text-lg font-semibold tracking-tight text-surface-100">
          Welcome{name ? `, ${name}` : ""}
        </h2>
        <p className="mx-auto max-w-sm text-sm text-surface-400">
          I’m ready to explore your organisation’s knowledge. Ask anything to
          begin a focused conversation.
        </p>
        {/* One click fills the composer with a proven starting question — it is
            not sent automatically, so the user can review or edit it first. */}
        <div
          className="mt-6 flex w-full flex-wrap justify-center gap-2"
          aria-label="Starter questions"
        >
          {STARTER_PROMPTS.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => onPick(prompt)}
              className="glass-chip rounded-full px-3.5 py-2 text-xs text-surface-300 transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-400/40 hover:text-surface-100 focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              {prompt}
            </button>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-surface-500">
          Pick a starter or write your own — Enter to send.
        </p>
      </div>
    </div>
  );
}

function MessagesSkeleton() {
  return (
    <div className="space-y-4">
      {[1, 2].map((i) => (
        <div
          key={i}
          className={cn("flex", i % 2 === 0 ? "justify-end" : "justify-start")}
        >
          <div
            className={cn(
              "h-16 animate-pulse rounded-[24px]",
              i % 2 === 0 ? "w-56 bubble-user" : "ml-9 w-72 bubble-ai"
            )}
          />
        </div>
      ))}
    </div>
  );
}
