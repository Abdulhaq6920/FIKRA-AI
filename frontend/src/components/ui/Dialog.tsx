"use client";

/**
 * Accessible dialog shell.
 *
 * Single implementation for every in-app modal (delete confirmations, comment
 * prompts). Replaces the ad-hoc fixed-overlay markup each feature used to hand
 * roll, so overlays consistently get `role="dialog"`, `aria-modal`, Escape
 * handling and a focusable panel — the native `window.confirm` / `window.prompt`
 * were the last native surfaces left and neither supported keyboard/screen
 * reader interaction properly.
 */

import { useEffect, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export function Dialog({
  open,
  title,
  description,
  children,
  footer,
  onClose,
  wide = false,
}: {
  open: boolean;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  /** Action row rendered at the bottom of the panel. */
  footer?: ReactNode;
  onClose: () => void;
  /** Wide variant for content that needs more vertical room (comment boxes). */
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
            onClick={(event) => event.stopPropagation()}
            className={cn(
              "w-full rounded-2xl border border-surface-700 bg-surface-900 p-5 shadow-2xl",
              wide ? "max-w-md" : "max-w-sm"
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-surface-100">{title}</h2>
                {description && (
                  <div className="mt-1.5 text-sm text-surface-400">{description}</div>
                )}
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close dialog"
                className="rounded p-1 text-surface-400 transition-colors hover:bg-surface-800 hover:text-surface-100 focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {children && <div className="mt-4">{children}</div>}

            {footer && <div className="mt-5 flex justify-end gap-2">{footer}</div>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
