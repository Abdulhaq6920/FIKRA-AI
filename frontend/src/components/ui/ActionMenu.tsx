"use client";

/**
 * ActionMenu — the vertical "kebab" row menu used by documents and admin
 * tables.
 *
 * Why a portal: rows live inside scroll containers and occasionally inside
 * transformed ancestors (hover depth effects), both of which would clip or
 * misplace an absolutely-positioned dropdown. The menu is therefore rendered
 * into `document.body` with fixed coordinates measured from the trigger.
 *
 * The surface itself fades/scales in place (never slides), closes on outside
 * click, Escape, scroll and resize, and supports full keyboard traversal.
 */

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { MoreVertical } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { signalCompanion, type CompanionAction } from "@/lib/companion";

export interface ActionMenuItem {
  /** Stable key; falls back to the label. */
  key?: string;
  label: string;
  icon?: React.ReactNode;
  onSelect?: () => void;
  /** Renders the entry as a download link instead of a button. */
  href?: string;
  download?: boolean;
  tone?: "default" | "danger" | "success";
  /** Which reaction the anime companion performs for this entry. */
  reaction?: CompanionAction;
  disabled?: boolean;
  /** Draw a divider above this entry. */
  separator?: boolean;
}

interface ActionMenuProps {
  items: ActionMenuItem[];
  /** Accessible name, e.g. "Actions for report.pdf". */
  label: string;
  align?: "start" | "end";
  className?: string;
  triggerClassName?: string;
}

const MENU_WIDTH = 208;
const GAP = 6;
const VIEWPORT_PAD = 8;
const ITEM_HEIGHT = 38;

const TONE_CLASS: Record<NonNullable<ActionMenuItem["tone"]>, string> = {
  default: "text-surface-200 hover:bg-surface-800 focus:bg-surface-800",
  danger: "text-red-300 hover:bg-red-500/10 focus:bg-red-500/10",
  success: "text-emerald-300 hover:bg-emerald-500/10 focus:bg-emerald-500/10",
};

export function ActionMenu({
  items,
  label,
  align = "end",
  className,
  triggerClassName,
}: ActionMenuProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const [mounted, setMounted] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();

  useEffect(() => setMounted(true), []);

  const close = useCallback(() => setOpen(false), []);

  const place = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const height = Math.min(320, items.length * ITEM_HEIGHT + 14);

    const maxLeft = Math.max(VIEWPORT_PAD, window.innerWidth - MENU_WIDTH - VIEWPORT_PAD);
    const preferredLeft = align === "end" ? rect.right - MENU_WIDTH : rect.left;
    const left = Math.min(Math.max(VIEWPORT_PAD, preferredLeft), maxLeft);

    const below = rect.bottom + GAP;
    const above = rect.top - height - GAP;
    const fitsBelow = below + height <= window.innerHeight - VIEWPORT_PAD;
    const top = !fitsBelow && above >= VIEWPORT_PAD ? above : below;

    setPosition({ top, left });
  }, [align, items.length]);

  const openMenu = useCallback(() => {
    place();
    setOpen(true);
    // The companion leans in whenever a menu is opened.
    signalCompanion("think", 900);
  }, [place]);

  // Measure once after mount so the menu appears in the right place before
  // the user can perceive a jump; keep it anchored while the window resizes.
  useEffect(() => {
    if (!open) return;
    place();
    const onResize = () => place();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [open, place]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        triggerRef.current?.focus();
      }
    };
    const onScroll = () => close();

    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, [open, close]);

  // Move focus into the menu when it opens so keyboard users land on it.
  useEffect(() => {
    if (!open) return;
    const first = menuRef.current?.querySelector<HTMLElement>(
      "[role='menuitem']:not([aria-disabled='true'])"
    );
    first?.focus({ preventScroll: true });
  }, [open]);

  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const entries = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>(
        "[role='menuitem']:not([aria-disabled='true'])"
      ) ?? []
    );
    if (!entries.length) return;
    const current = entries.indexOf(document.activeElement as HTMLElement);
    const delta = event.key === "ArrowDown" ? 1 : -1;
    const next = (current + delta + entries.length) % entries.length;
    entries[next]?.focus();
  };

  const run = (item: ActionMenuItem) => {
    if (item.disabled) return;
    close();
    signalCompanion(
      item.reaction ?? (item.tone === "danger" ? "alert" : "success"),
      1200
    );
    item.onSelect?.();
  };

  return (
    <div className={cn("relative inline-flex", className)}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close() : openMenu())}
        className={cn(
          "rounded-lg p-1.5 text-surface-400 transition-colors duration-200",
          "hover:bg-surface-800 hover:text-surface-100",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50",
          open && "bg-surface-800 text-surface-100",
          triggerClassName
        )}
      >
        <MoreVertical className="h-4 w-4" aria-hidden="true" />
      </button>

      {mounted &&
        createPortal(
          <AnimatePresence>
            {open && position && (
              <motion.div
                id={menuId}
                ref={menuRef}
                role="menu"
                aria-label={label}
                onKeyDown={onMenuKeyDown}
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.97 }}
                transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                style={{
                  position: "fixed",
                  top: position.top,
                  left: position.left,
                  width: MENU_WIDTH,
                }}
                className={cn(
                  "z-[80] overflow-hidden rounded-xl border border-surface-700/80",
                  "bg-surface-900/95 p-1 shadow-[0_24px_60px_-18px_rgba(0,0,0,0.7)]",
                  "backdrop-blur-xl"
                )}
              >
                {items.map((item, index) => {
                  const content = (
                    <>
                      {item.icon && (
                        <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center opacity-80">
                          {item.icon}
                        </span>
                      )}
                      <span className="truncate">{item.label}</span>
                    </>
                  );
                  const entryClass = cn(
                    "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs font-medium",
                    "transition-colors duration-150 focus:outline-none",
                    TONE_CLASS[item.tone ?? "default"],
                    item.disabled && "cursor-not-allowed opacity-40 hover:bg-transparent"
                  );

                  return (
                    <div key={item.key ?? item.label}>
                      {item.separator && index > 0 && (
                        <div className="my-1 h-px bg-surface-800/80" aria-hidden="true" />
                      )}
                      {item.href ? (
                        <a
                          role="menuitem"
                          href={item.href}
                          download={item.download}
                          aria-disabled={item.disabled || undefined}
                          onClick={() => {
                            close();
                            signalCompanion(item.reaction ?? "success", 1200);
                          }}
                          className={entryClass}
                        >
                          {content}
                        </a>
                      ) : (
                        <button
                          type="button"
                          role="menuitem"
                          disabled={item.disabled}
                          aria-disabled={item.disabled || undefined}
                          onClick={() => run(item)}
                          className={entryClass}
                        >
                          {content}
                        </button>
                      )}
                    </div>
                  );
                })}
              </motion.div>
            )}
          </AnimatePresence>,
          document.body
        )}
    </div>
  );
}
