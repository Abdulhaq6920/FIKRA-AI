"use client";

/**
 * Theme picker used by Settings.
 *
 * Every shipped theme is animated; previews are pure CSS so the grid stays
 * instant without decoding image assets.
 */

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown, Moon, Palette, Sparkles, Sun } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useTheme } from "./ThemeProvider";
import {
  FANTASY_THEMES,
  SIGNATURE_THEMES,
  type ThemeDefinition,
} from "./themes";

export function ThemePicker() {
  const { theme, definition, setTheme } = useTheme();
  const [open, setOpen] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1.5">
          <p className="text-xs text-surface-500">
            Choose an animated palette for this browser. Your selection applies
            instantly and is remembered.
          </p>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-surface-700 bg-surface-850 px-2.5 py-1 text-[11px] text-surface-400">
              {definition.mode === "dark" ? (
                <Moon className="h-3 w-3" />
              ) : (
                <Sun className="h-3 w-3" />
              )}
              {definition.name}
            </span>
            <span className="flex items-center gap-1" aria-hidden="true">
              {definition.swatches.map((swatch, index) => (
                <span
                  key={`${swatch}-${index}`}
                  className="h-3.5 w-3.5 rounded-full border border-black/10"
                  style={{ background: swatch }}
                />
              ))}
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls="theme-picker-panel"
          className="inline-flex items-center gap-2 rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-xs font-medium text-surface-200 transition-colors hover:bg-surface-800 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
        >
          <Palette className="h-3.5 w-3.5 text-brand-400" />
          {open ? "Hide themes" : "Change theme"}
          <ChevronDown
            className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")}
          />
        </button>
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id="theme-picker-panel"
            key="theme-picker-panel"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className="space-y-6 pt-1">
              <ThemeGroup
                title="Signature"
                hint="Royal Glass — the default, lit by amber, bronze and indigo"
                themes={SIGNATURE_THEMES}
                activeTheme={theme}
                onSelect={setTheme}
              />

              <ThemeGroup
                title="Fantasy"
                hint="Seven animated storybook worlds — drifting light, embers and stars"
                themes={FANTASY_THEMES}
                activeTheme={theme}
                onSelect={setTheme}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ThemeGroup({
  title,
  hint,
  themes,
  activeTheme,
  onSelect,
}: {
  title: string;
  hint: string;
  themes: readonly ThemeDefinition[];
  activeTheme: string;
  onSelect: (theme: ThemeDefinition["id"]) => void;
}) {
  return (
    <section aria-labelledby={`theme-group-${title}`}>
      <div className="mb-3 flex items-center gap-2">
        <h3
          id={`theme-group-${title}`}
          className="text-[11px] font-semibold uppercase tracking-[0.14em] text-surface-500"
        >
          {title}
        </h3>
        <span className="text-[11px] text-surface-500">· {hint}</span>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {themes.map((item, index) => {
          const active = activeTheme === item.id;
          return (
            <motion.button
              key={item.id}
              type="button"
              onClick={() => onSelect(item.id)}
              aria-pressed={active}
              aria-label={`Use ${item.name} theme`}
              initial={{ opacity: 0, scale: 0.985 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: index * 0.025 }}
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.985 }}
              className={cn(
                "group relative overflow-hidden rounded-xl border border-surface-800 bg-surface-900 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500",
                active && "border-brand-500 ring-1 ring-brand-500/30"
              )}
            >
              <MiniPreview theme={item} />

              <div className="flex items-center gap-2 border-t border-surface-800/80 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-surface-100">
                    {item.name}
                  </p>
                  <p className="mt-0.5 line-clamp-1 text-[10px] text-surface-500">
                    {item.description}
                  </p>
                </div>
                <span
                  className={cn(
                    "flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border transition-colors",
                    active
                      ? "border-brand-500 bg-brand-500 text-white"
                      : "border-surface-700 text-transparent group-hover:border-surface-600"
                  )}
                  aria-hidden="true"
                >
                  <Check className="h-3 w-3" />
                </span>
              </div>
            </motion.button>
          );
        })}
      </div>
    </section>
  );
}

function MiniPreview({ theme }: { theme: ThemeDefinition }) {
  const [canvas, card, accent] = theme.swatches;
  const isLight = theme.mode === "light";
  return (
    <div
      className="relative h-24 overflow-hidden p-2.5"
      style={{ background: canvas }}
    >
      <div className="flex h-full overflow-hidden rounded-lg border border-black/5 bg-white/40 shadow-sm">
        <div className="w-9 space-y-1.5 p-1.5" style={{ background: card }}>
          <div className="h-2 w-2 rounded-full" style={{ background: accent }} />
          <div className="h-1 w-full rounded-full bg-slate-500/30" />
          <div className="h-1 w-4/5 rounded-full bg-slate-500/30" />
          <div className="h-1 w-3/5 rounded-full bg-slate-500/30" />
        </div>
        <div className="flex-1 space-y-1.5 p-2" style={{ background: card }}>
          <div className="h-1.5 w-3/5 rounded-full" style={{ background: accent }} />
          <div className="h-1 w-full rounded-full bg-slate-500/30" />
          <div className="h-1 w-5/6 rounded-full bg-slate-500/30" />
          <div className="mt-2 flex gap-1">
            <div className="h-5 flex-1 rounded" style={{ background: `${accent}22` }} />
            <div className="h-5 flex-1 rounded" style={{ background: `${accent}22` }} />
            <div className="h-5 flex-1 rounded" style={{ background: `${accent}22` }} />
          </div>
        </div>
      </div>

      {/* Preview the live ambient FX with a looping shimmer sweep + badge. */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <span
          className="absolute inset-y-0 -left-1/2 w-1/2 animate-[fancyShimmer_3.2s_ease-in-out_infinite]"
          style={{
            background: `linear-gradient(100deg, transparent, ${
              isLight ? "rgba(255,255,255,0.75)" : "rgba(255,255,255,0.35)"
            }, transparent)`,
          }}
        />
      </div>
      <span
        className="absolute right-1.5 top-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider backdrop-blur"
        style={{
          background: isLight ? "rgba(15,23,42,0.10)" : "rgba(0,0,0,0.35)",
          color: isLight ? "#1e293b" : "#ffffff",
        }}
      >
        <Sparkles className="h-2.5 w-2.5" /> Animated
      </span>
    </div>
  );
}
