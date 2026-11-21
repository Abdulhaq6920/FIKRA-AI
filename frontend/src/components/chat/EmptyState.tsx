"use client";

/**
 * Empty state shown when no conversation is active.
 * Surfaces favourite questions and starter prompts.
 */

import { Star, X, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { normalizeQuestion, STARTER_PROMPTS, truncateQuestion } from "./constants";
import type { FavoriteQuestion } from "@/types";

export function EmptyState({
  name,
  favorites,
  onPick,
  onRemoveFavorite,
}: {
  name?: string;
  favorites: FavoriteQuestion[];
  onPick: (prompt: string) => void;
  onRemoveFavorite: (id: string) => void;
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

        {favorites.length > 0 && (
          <section
            aria-label="Favourite questions"
            className="mt-5 rounded-2xl border border-brand-400/25 bg-brand-500/[0.07] p-3 text-left"
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-brand-200/85">
                <Star className="h-3 w-3 text-brand-300" aria-hidden="true" />
                Your favourite questions
              </p>
              <span className="rounded-full bg-brand-500/15 px-1.5 py-0.5 text-[9px] font-bold text-brand-200">
                {favorites.length}
              </span>
            </div>
            <div className="flex max-h-32 flex-wrap items-start gap-1.5 overflow-y-auto pr-1">
              {favorites.map((entry) => (
                <span
                  key={entry.id}
                  className="glass-chip inline-flex max-w-full items-center rounded-full py-1 pl-3 pr-1"
                >
                  <button
                    type="button"
                    onClick={() => onPick(entry.question)}
                    title={entry.question}
                    className="max-w-[16rem] truncate text-left text-[11.5px] text-surface-300 transition-colors hover:text-surface-100 focus:outline-none focus:ring-2 focus:ring-brand-500/40 sm:max-w-[19rem]"
                  >
                    {entry.question}
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemoveFavorite(entry.id)}
                    aria-label={`Remove favourite: ${entry.question}`}
                    title="Remove favourite"
                    className="ml-1 rounded-full p-0.5 text-surface-500 transition-colors hover:bg-red-400/10 hover:text-red-300 focus:outline-none focus:ring-2 focus:ring-red-400/40"
                  >
                    <X className="h-2.5 w-2.5" aria-hidden="true" />
                  </button>
                </span>
              ))}
            </div>
          </section>
        )}

        <div
          className="mt-6 flex w-full flex-wrap justify-center gap-2"
          aria-label="Starter questions"
        >
          {STARTER_PROMPTS.filter(
            (prompt) =>
              !favorites.some(
                (entry) => normalizeQuestion(entry.question) === normalizeQuestion(prompt)
              )
          ).map((prompt) => (
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
