"use client";

/**
 * Chat page — main conversation area.
 * The conversation list is now in the AppShell sidebar.
 * This page handles: message display, streaming, citations, feedback.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import {
  Send,
  Copy,
  ThumbsUp,
  ThumbsDown,
  MessageSquare,
  Radio,
  Cpu,
  Zap,
  Square,
} from "lucide-react";
import { chatApi } from "@/lib/api/chat";
import { ApiRequestError } from "@/lib/api/client";
import { cn } from "@/lib/utils/cn";
import { truncate } from "@/lib/utils/format";
import type { Message, Citation } from "@/types";
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

export default function ChatPage() {
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sendingSessions, setSendingSessions] = useState<Record<string, boolean>>({});
  const [streamingSessions, setStreamingSessions] = useState<Record<string, string | null>>({});
  const [sessionErrors, setSessionErrors] = useState<Record<string, string>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const activeConversationRef = useRef<string | null>(null);
  const streamControllersRef = useRef<Record<string, AbortController>>({});
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();

  useEffect(() => {
    const conversationId = searchParams.get("conversation");
    activeConversationRef.current = conversationId;
    setActiveConvId(conversationId);
    setMessages([]);
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

  // Load messages when conversation changes
  useEffect(() => {
    if (!activeConvId) { setMessages([]); return; }
    let cancelled = false;
    setLoadingMsgs(true);
    chatApi.getMessages(activeConvId)
      .then((loadedMessages) => { if (!cancelled) setMessages(loadedMessages); })
      .catch(() => { if (!cancelled) setMessages([]); })
      .finally(() => { if (!cancelled) setLoadingMsgs(false); });
    return () => { cancelled = true; };
  }, [activeConvId]);

  // Scroll to bottom
  useEffect(() => {
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

  const handleSend = async () => {
    const question = input.trim();
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
        return;
      }
    }

    setInput("");
    setSendingSessions((previous) => ({ ...previous, [convId]: true }));
    setSessionError(convId, null);

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

      if (
        !streamFailed &&
        !controller.signal.aborted &&
        activeConversationRef.current === convId
      ) {
        setMessages((previous) => [
          ...previous.map((msg) =>
            meta && msg.id === tempMsg.id ? { ...msg, id: meta.user_message_id } : msg
          ),
          {
            id: meta?.assistant_message_id ?? `stream-${Date.now()}`,
            role: "assistant",
            content: accumulated,
            citations: meta?.citations ?? null,
            model_used: meta?.model_used ?? null,
            created_at: new Date().toISOString(),
          },
        ]);
      }
      setStreamingSessions((previous) => ({ ...previous, [convId]: null }));
      window.dispatchEvent(new CustomEvent(CONV_REFRESH_EVENT));
    } catch (err) {
      setStreamingSessions((previous) => ({ ...previous, [convId]: null }));
      if (err instanceof DOMException && err.name === "AbortError") return;
      if (err instanceof ApiRequestError) {
        setSessionError(convId, err.message);
      } else {
        setSessionError(convId, "Something went wrong. Please try again.");
      }
    } finally {
      delete streamControllersRef.current[convId];
      setSendingSessions((previous) => ({ ...previous, [convId]: false }));
    }
  };

  const handleStop = () => {
    if (activeConvId) {
      // Abort the fetch (closes the ReadableStream on the client side)
      streamControllersRef.current[activeConvId]?.abort();
      // Also signal the server to stop yielding chunks
      if (input || activeConvId) {
        chatApi.cancelStream("", activeConvId).catch(() => {});
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFeedback = async (messageId: string, type: "thumbs_up" | "thumbs_down") => {
    const comment = type === "thumbs_down"
      ? window.prompt("What should we improve about this answer?")?.trim()
      : undefined;
    if (type === "thumbs_down" && !comment) return;
    await chatApi.submitFeedback(messageId, type, comment).catch(() => {});
  };

  const error = activeConvId ? sessionErrors[activeConvId] ?? null : generalError;
  const sending = activeConvId ? Boolean(sendingSessions[activeConvId]) : false;
  const streamingText = activeConvId ? streamingSessions[activeConvId] ?? null : null;

  return (
    <div className="relative flex flex-col h-full overflow-hidden bg-surface-950">
      <div className="pointer-events-none absolute inset-0 cyber-grid opacity-40" />
      <div className="pointer-events-none absolute top-[-16rem] left-1/2 h-[34rem] w-[52rem] -translate-x-1/2 rounded-full bg-cyan-500/10 blur-[130px]" />
      <header className="relative z-10 flex h-16 items-center justify-between border-b border-cyan-300/10 bg-surface-950/65 px-5 backdrop-blur-xl md:px-8">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-cyan-300/30 bg-cyan-400/10 shadow-[0_0_28px_rgba(34,211,238,0.16)]">
            <Cpu className="h-4 w-4 text-cyan-300" />
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-cyan-300/70">AI Knowledge Assistant</p>
            <h1 className="text-sm font-semibold text-surface-100">FIKRA AI</h1>
          </div>
        </div>
        <div className="mr-12 hidden items-center gap-2 sm:flex">
          <div className="flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/5 px-3 py-1.5 text-[11px] font-medium text-emerald-300">
            <Radio className="h-3 w-3 animate-pulse" />
            System online
          </div>
        </div>
      </header>
      {/* Messages area */}
      <div className="relative z-10 flex-1 overflow-y-auto p-4 space-y-5 md:p-8">
        {!activeConvId && !loadingMsgs && messages.length === 0 && (
          <EmptyState name={user?.full_name} />
        )}

        {loadingMsgs && <MessagesSkeleton />}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} onFeedback={handleFeedback} />
        ))}

        {sending && streamingText === null && <SseLoadingIndicator />}

        {streamingText !== null && <StreamingBubble text={streamingText} />}

        {error && (
          <div className="flex justify-center">
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-sm text-red-400 max-w-xl">
              {error}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Composer */}
      <div className="relative z-10 border-t border-cyan-300/10 bg-surface-950/75 p-4 backdrop-blur-xl flex-shrink-0 md:px-8 md:pb-6">
        <div className="max-w-3xl mx-auto">
          <div className="relative flex items-end gap-3 rounded-2xl border border-cyan-300/15 bg-surface-900/75 px-4 py-3 shadow-[0_0_40px_rgba(34,211,238,0.05)] transition-all focus-within:border-cyan-300/50 focus-within:shadow-[0_0_48px_rgba(34,211,238,0.13)]">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                activeConvId
                  ? "Ask a question about your documents… (Enter to send)"
                  : "Start a new conversation by asking a question…"
              }
              rows={1}
              className="flex-1 bg-transparent text-surface-100 text-sm resize-none outline-none placeholder:text-surface-500 max-h-36 overflow-y-auto"
              aria-label="Chat input"
              style={{ lineHeight: "1.5" }}
              onInput={(e) => {
                const el = e.currentTarget;
                el.style.height = "auto";
                el.style.height = `${Math.min(el.scrollHeight, 144)}px`;
              }}
            />
            <button
              onClick={sending ? handleStop : handleSend}
              disabled={sending ? false : !input.trim()}
              className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-400 to-brand-500 text-surface-950 shadow-[0_0_24px_rgba(34,211,238,0.35)] transition-all hover:scale-105 disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-cyan-300"
              aria-label={sending ? "Stop response" : "Send message"}
            >
              {sending ? (
                <Square className="w-3.5 h-3.5 fill-current" />
              ) : (
                <Send className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
          <p className="mt-2 flex items-center justify-center gap-1.5 text-[11px] text-surface-500">
            <Zap className="h-3 w-3 text-cyan-400" />
            Grounded responses are synthesized from your indexed documents.
          </p>
        </div>
      </div>
    </div>
  );
}

function SseLoadingIndicator() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
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

function MessageBubble({
  message,
  onFeedback,
}: {
  message: Message;
  onFeedback: (id: string, type: "thumbs_up" | "thumbs_down") => void;
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
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn("flex", isUser ? "justify-end" : "justify-start")}
    >
      <div className={cn("max-w-3xl w-full float-in", isUser ? "ml-12" : "mr-12")}>
        <div
          className={cn(
            "text-sm shadow-lg",
            isUser
              ? "rounded-2xl rounded-tr-sm border border-cyan-300/25 bg-gradient-to-br from-brand-600/35 to-cyan-500/15 px-4 py-3 text-surface-100 shadow-cyan-950/20"
              : "rounded-2xl rounded-tl-sm border border-surface-700/70 bg-surface-900/75 px-4 py-3 text-surface-100 shadow-black/20 backdrop-blur-sm"
          )}
        >
          {isUser ? (
            <p className="whitespace-pre-wrap">{message.content}</p>
          ) : (
            <MarkdownContent content={message.content} />
          )}
        </div>

        {!isUser && (
          <div className="flex items-center gap-2 mt-1.5 ml-1">
            <button onClick={handleCopy} className="text-xs text-surface-500 hover:text-surface-300 flex items-center gap-1 focus:outline-none" aria-label="Copy answer">
              <Copy className="w-3 h-3" />
              {copied ? "Copied!" : "Copy"}
            </button>
            <button onClick={() => onFeedback(message.id, "thumbs_up")} className="text-surface-500 hover:text-green-400 focus:outline-none" aria-label="Good response">
              <ThumbsUp className="w-3 h-3" />
            </button>
            <button onClick={() => onFeedback(message.id, "thumbs_down")} className="text-surface-500 hover:text-red-400 focus:outline-none" aria-label="Bad response">
              <ThumbsDown className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>
    </motion.div>
  );
}

function StreamingBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-start">
      <div className="max-w-3xl mr-12 rounded-2xl rounded-tl-sm border border-cyan-300/25 bg-surface-900/85 px-4 py-3 text-sm text-surface-100 shadow-[0_0_32px_rgba(34,211,238,0.08)] backdrop-blur-sm">
        <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-300/70">
          <Radio className="h-3 w-3 animate-pulse" />
          Synthesizing answer
        </div>
        <MarkdownContent content={text} streaming />
      </div>
    </div>
  );
}

function EmptyState({ name }: { name?: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full py-20 text-center px-4">
      <div className="w-14 h-14 rounded-2xl bg-brand-600/20 border border-brand-500/30 flex items-center justify-center mb-4">
        <MessageSquare className="w-6 h-6 text-brand-400" />
      </div>
      <h2 className="text-lg font-semibold text-surface-100 mb-1">Welcome{name ? `, ${name}` : ""}</h2>
      <p className="text-sm text-surface-400 max-w-sm">
        I’m ready to explore your organization’s knowledge. Ask anything to begin a focused conversation.
      </p>
    </div>
  );
}

function MessagesSkeleton() {
  return (
    <div className="space-y-4">
      {[1, 2].map((i) => (
        <div key={i} className={cn("flex", i % 2 === 0 ? "justify-end" : "justify-start")}>
          <div className="w-64 h-16 rounded-2xl bg-surface-800 animate-pulse" />
        </div>
      ))}
    </div>
  );
}
