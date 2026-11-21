"use client";

/**
 * Favourite questions panel — per-user saved questions, shown in the composer
 * area and in the empty state.
 */

import { motion } from "framer-motion";
import { Star, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { FavoriteQuestion } from "@/types";

export function FavoritesPanel({
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
