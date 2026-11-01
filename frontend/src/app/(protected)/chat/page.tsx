"use client";

/**
 * Chat page — main conversation area.
 * The conversation list is now in the AppShell sidebar.
 * This page handles: message display, streaming, citations, feedback.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Send,
  Copy,
  ThumbsUp,
  ThumbsDown,
  BookOpen,
  MessageSquare,
  ChevronRight,
  Radio,
  Cpu,
  Zap,
  Square,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { chatApi } from "@/lib/api/chat";
import { api, ApiRequestError } from "@/lib/api/client";
import { cn } from "@/lib/utils/cn";
import { truncate } from "@/lib/utils/format";
import type { Message, Citation } from "@/types";
import { useAuth } from "@/features/auth/AuthContext";

// ─── Context bridge — AppShell needs to know about active conversation ─────
// We use a global event bus so AppShell can react to new conversations
// created from within this page.
const CONV_REFRESH_EVENT = "fikra:conv-refresh";

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
  const [accessRequestMessage, setAccessRequestMessage] = useState<string | null>(null);

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
            const payload = JSON.parse(data) as { text?: string; error?: string };
            if (payload.error) {
              setSessionError(convId, "The AI provider encountered an error. Please try again.");
              continue;
            }
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

      if (!controller.signal.aborted && activeConversationRef.current === convId) {
        setMessages((previous) => [
          ...previous,
          {
            id: `stream-${Date.now()}`,
            role: "assistant",
            content: accumulated,
            citations: null,
            model_used: null,
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

  const requestAdminAccess = async () => {
    const reason = window.prompt("Why do you need organization-admin access?")?.trim();
    if (reason === undefined) return;
    try {
      await api.post("/access-requests", { reason: reason || null });
      setAccessRequestMessage("Request sent to your organization administrators.");
    } catch (err) {
      setAccessRequestMessage(err instanceof Error ? err.message : "Could not send the request.");
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
            <h1 className="text-sm font-semibold text-white">FIKRA AI</h1>
          </div>
        </div>
        <div className="mr-12 hidden items-center gap-2 sm:flex">
          {!user?.is_platform_admin && user?.organization_role !== "org_admin" && (
            <button onClick={requestAdminAccess} className="rounded-full border border-cyan-300/20 bg-cyan-400/5 px-3 py-1.5 text-[11px] font-medium text-cyan-200 hover:bg-cyan-400/10">
              Request admin access
            </button>
          )}
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
        {accessRequestMessage && (
          <div className="flex justify-center"><div className="rounded-lg border border-cyan-400/20 bg-cyan-400/10 px-4 py-2 text-xs text-cyan-100">{accessRequestMessage}</div></div>
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
              className="flex-1 bg-transparent text-white text-sm resize-none outline-none placeholder:text-surface-500 max-h-36 overflow-y-auto"
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
  const [showCitations, setShowCitations] = useState(false);
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
            "rounded-2xl px-4 py-3 text-sm shadow-lg",
            isUser
              ? "rounded-tr-sm border border-cyan-300/25 bg-gradient-to-br from-brand-600/45 to-cyan-500/20 text-white shadow-cyan-950/30"
              : "rounded-tl-sm border border-surface-700/70 bg-surface-900/75 text-surface-100 shadow-black/20 backdrop-blur-sm"
          )}
        >
          {isUser ? (
            <p className="whitespace-pre-wrap">{message.content}</p>
          ) : (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                code({ className, children, ...props }) {
                  const match = /language-(\w+)/.exec(className || "");
                  const inline = !match;
                  return inline ? (
                    <code className="bg-surface-700 px-1 py-0.5 rounded text-xs font-mono" {...props}>
                      {children}
                    </code>
                  ) : (
                    <SyntaxHighlighter
                      style={oneDark as Record<string, React.CSSProperties>}
                      language={match[1]}
                      PreTag="div"
                      className="rounded-lg text-xs my-2"
                    >
                      {String(children).replace(/\n$/, "")}
                    </SyntaxHighlighter>
                  );
                },
                p: ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
                ul: ({ children }) => <ul className="list-disc list-inside mb-2 space-y-1">{children}</ul>,
                ol: ({ children }) => <ol className="list-decimal list-inside mb-2 space-y-1">{children}</ol>,
                li: ({ children }) => <li className="text-sm">{children}</li>,
                h1: ({ children }) => <h1 className="text-base font-semibold mb-2">{children}</h1>,
                h2: ({ children }) => <h2 className="text-sm font-semibold mb-2">{children}</h2>,
                h3: ({ children }) => <h3 className="text-sm font-medium mb-1">{children}</h3>,
              }}
            >
              {message.content}
            </ReactMarkdown>
          )}
        </div>

        {!isUser && (
          <div className="flex items-center gap-2 mt-1.5 ml-1">
            {message.citations && message.citations.length > 0 && (
              <button
                onClick={() => setShowCitations((s) => !s)}
                className="flex items-center gap-1 text-xs text-surface-500 hover:text-brand-400 transition-colors focus:outline-none"
              >
                <BookOpen className="w-3 h-3" />
                {message.citations.length} source{message.citations.length !== 1 ? "s" : ""}
                <ChevronRight className={cn("w-3 h-3 transition-transform", showCitations && "rotate-90")} />
              </button>
            )}
            <button onClick={handleCopy} className="text-xs text-surface-500 hover:text-surface-300 flex items-center gap-1 focus:outline-none" aria-label="Copy">
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

        <AnimatePresence>
          {showCitations && message.citations && message.citations.length > 0 && (
            <CitationsPanel citations={message.citations} />
          )}
        </AnimatePresence>
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
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
        <span className="ml-1 inline-block h-4 w-1.5 animate-pulse align-middle bg-cyan-300" />
      </div>
    </div>
  );
}

function CitationsPanel({ citations }: { citations: Citation[] }) {
  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      className="mt-2 ml-1 space-y-2 overflow-hidden"
    >
      {citations.map((c) => (
        <div
          key={c.source_number}
          className="flex gap-2 p-2.5 rounded-lg bg-surface-800/60 border border-surface-700/40 text-xs"
        >
          <span className="flex-shrink-0 w-5 h-5 rounded bg-brand-600/30 text-brand-400 flex items-center justify-center font-medium text-[10px]">
            {c.source_number}
          </span>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-surface-200 truncate">{c.document_title}</p>
            <p className="text-surface-500">
              {c.page_number && `Page ${c.page_number}`}
              {c.page_number && c.section_heading && " · "}
              {c.section_heading}
            </p>
            <p className="text-surface-400 mt-0.5 line-clamp-2">{c.excerpt}</p>
          </div>
        </div>
      ))}
    </motion.div>
  );
}

function EmptyState({ name }: { name?: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full py-20 text-center px-4">
      <div className="w-14 h-14 rounded-2xl bg-brand-600/20 border border-brand-500/30 flex items-center justify-center mb-4">
        <MessageSquare className="w-6 h-6 text-brand-400" />
      </div>
      <h2 className="text-lg font-semibold text-white mb-1">Welcome{name ? `, ${name}` : ""}</h2>
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
