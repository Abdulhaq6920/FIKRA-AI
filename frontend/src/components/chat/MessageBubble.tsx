"use client";

/**
 * A single chat message bubble — user or assistant, with copy, favourite,
 * feedback, and citation affordances.
 */

import { memo, useState } from "react";
import { Copy, Star, ThumbsDown, ThumbsUp } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { MarkdownContent } from "@/features/chat/MarkdownContent";
import { CitationList } from "./CitationList";
import { AssistantAvatar } from "./ui";
import type { Message, Citation } from "@/types";

export const MessageBubble = memo(function MessageBubble({
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
    <div
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
              type="button"
              onClick={handleCopy}
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
    </div>
  );
});
