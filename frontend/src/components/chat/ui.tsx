"use client";

/**
 * Small presentational chat UI primitives.
 */

import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export function AssistantAvatar() {
  return (
    <span
      className={cn(
        "glass-chip mb-1 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-brand-300"
      )}
      aria-hidden="true"
    >
      <Sparkles className="h-3.5 w-3.5" />
    </span>
  );
}

export function SseLoadingIndicator() {
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

export function MessagesSkeleton() {
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

export function PillButton({
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

export function MenuButton({
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
