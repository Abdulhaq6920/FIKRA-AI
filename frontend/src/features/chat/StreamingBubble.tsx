"use client";

/**
 * Streaming assistant message bubble shown while the SSE answer is arriving.
 */

import { Radio } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { MarkdownContent } from "@/features/chat/MarkdownContent";
import { AssistantAvatar } from "./ui";

export function StreamingBubble({ text }: { text: string }) {
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
