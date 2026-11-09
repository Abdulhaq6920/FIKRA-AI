"use client";

/**
 * CompanionScene — the anime characters as an integrated stage presence.
 *
 * The artwork is no longer boxed inside a manga panel. Instead the character
 * stands directly on the page against its own soft aura and slow rune rings,
 * so the anime themes feel like part of the interface rather than a sticker
 * pasted on top of it. The character still acts: it scans while the user
 * browses documents, "writes" while admin actions run, thinks while a menu is
 * open, and fires a light burst on success or a startled flash on danger.
 *
 * Every reaction is driven by `signalCompanion()` from anywhere in the app, so
 * the character stays relevant to what the user is actually doing. Motion is
 * skipped entirely for `prefers-reduced-motion` users.
 */

import { useEffect } from "react";
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from "framer-motion";
import type { TargetAndTransition, Transition } from "framer-motion";
import { cn } from "@/lib/utils/cn";
import { NinjaArtwork } from "./NinjaArtwork";
import type { CompanionAction } from "@/lib/companion";
import type { ThemeArtwork } from "./themes";

const CAPTIONS: Record<CompanionAction, { label: string; dot: string }> = {
  idle: { label: "Standing by", dot: "bg-surface-500" },
  read: { label: "Scanning the archive", dot: "bg-brand-300" },
  write: { label: "Issuing commands", dot: "bg-brand-300" },
  think: { label: "Thinking…", dot: "bg-amber-300" },
  success: { label: "Mission complete", dot: "bg-emerald-300" },
  alert: { label: "Careful, hunter", dot: "bg-red-400" },
};

const CHARACTER_MOTION: Record<
  CompanionAction,
  { animate: TargetAndTransition; transition: Transition }
> = {
  idle: {
    animate: { y: [0, -5, 0], rotate: [-1, -0.4, -1] },
    transition: { duration: 7, repeat: Infinity, ease: "easeInOut" },
  },
  read: {
    animate: { y: [0, -3, 0], rotate: [-1.8, -0.2, -1.8] },
    transition: { duration: 4.4, repeat: Infinity, ease: "easeInOut" },
  },
  write: {
    animate: { y: [0, -2, 0], rotate: [-2.4, -0.2, -2.4] },
    transition: { duration: 2.8, repeat: Infinity, ease: "easeInOut" },
  },
  think: {
    animate: { y: [0, -4, 0], scale: [1, 1.012, 1], rotate: [-1, -1, -1] },
    transition: { duration: 5.2, repeat: Infinity, ease: "easeInOut" },
  },
  success: {
    animate: { y: [0, -14, 0], scale: [1, 1.06, 1], rotate: [-1, 1.5, -1] },
    transition: { duration: 0.85, ease: [0.16, 1, 0.3, 1] },
  },
  alert: {
    animate: { x: [0, -6, 5, -4, 0], rotate: [-1, -3, 1.5, -1, -1] },
    transition: { duration: 0.5, ease: "easeInOut" },
  },
};

const DUST = [
  { left: 16, top: 40, size: 2 },
  { left: 40, top: 24, size: 1.5 },
  { left: 72, top: 48, size: 2 },
  { left: 86, top: 30, size: 1.5 },
  { left: 54, top: 66, size: 1.5 },
] as const;

export function CompanionScene({
  variant,
  action,
  className,
}: {
  variant: ThemeArtwork;
  action: CompanionAction;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const still = reduced === true;
  const caption = CAPTIONS[action];
  const motionSpec = CHARACTER_MOTION[action];

  // Pointer parallax gives the flat artwork real 3D depth in every anime theme.
  const pointerX = useMotionValue(0);
  const pointerY = useMotionValue(0);
  const rotateY = useSpring(useTransform(pointerX, [-1, 1], [-6, 6]), {
    stiffness: 60,
    damping: 18,
    mass: 0.5,
  });
  const rotateX = useSpring(useTransform(pointerY, [-1, 1], [4, -4]), {
    stiffness: 60,
    damping: 18,
    mass: 0.5,
  });

  useEffect(() => {
    if (still) return;
    const onMove = (event: PointerEvent) => {
      pointerX.set((event.clientX / window.innerWidth - 0.5) * 2);
      pointerY.set((event.clientY / window.innerHeight - 0.5) * 2);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, [pointerX, pointerY, still]);

  return (
    <div
      aria-hidden="true"
      data-companion={variant}
      data-action={action}
      className={cn(
        "pointer-events-none fixed bottom-2 right-2 z-20 hidden w-[250px] select-none lg:block",
        className
      )}
    >
      <motion.div
        style={{ rotateX, rotateY, transformPerspective: 1000 }}
        className="[transform-style:preserve-3d]"
      >
        {/* Soft stage light — the character sits in the page, not on a card. */}
        <motion.div
          className="absolute bottom-16 left-1/2 h-64 w-64 -translate-x-1/2 rounded-full blur-[58px]"
          style={{
            background:
              "radial-gradient(circle, rgb(var(--brand-400) / 0.34), rgb(var(--brand-700) / 0.1) 50%, transparent 72%)",
          }}
          animate={
            still ? undefined : { scale: [1, 1.14, 1], opacity: [0.62, 0.92, 0.62] }
          }
          transition={
            still ? undefined : { duration: 7.5, repeat: Infinity, ease: "easeInOut" }
          }
        />

        {/* Orbital rune rings — thin, luminous, always turning slowly. */}
        <motion.div
          className="absolute bottom-24 left-1/2 h-52 w-52 -translate-x-1/2 rounded-full border border-brand-300/25"
          animate={still ? undefined : { rotate: 360 }}
          transition={still ? undefined : { duration: 26, repeat: Infinity, ease: "linear" }}
        >
          <span className="absolute -top-1 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-brand-200 shadow-[0_0_10px_rgb(var(--brand-300))]" />
          <span className="absolute -bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-brand-400" />
          <span className="absolute -right-1 top-1/2 h-1 w-1 -translate-y-1/2 rounded-full bg-brand-300" />
        </motion.div>
        <motion.div
          className="absolute bottom-28 left-1/2 h-40 w-40 -translate-x-1/2 rounded-full border border-dashed border-brand-200/20"
          animate={still ? undefined : { rotate: -360 }}
          transition={still ? undefined : { duration: 38, repeat: Infinity, ease: "linear" }}
        />

        {/* Floating dust keeps the stage alive even at rest. */}
        {DUST.map((mote, index) => (
          <motion.span
            key={`dust-${index}`}
            className="absolute rounded-full bg-brand-200/70"
            style={{
              left: `${mote.left}%`,
              top: `${mote.top}%`,
              width: mote.size,
              height: mote.size,
              boxShadow: "0 0 8px rgb(var(--brand-300) / 0.75)",
            }}
            animate={
              still
                ? undefined
                : { y: [0, -18, 0], opacity: [0.08, 0.7, 0.08], scale: [0.8, 1.2, 0.8] }
            }
            transition={
              still
                ? undefined
                : {
                    duration: 4.6 + index * 1.15,
                    delay: index * 0.62,
                    repeat: Infinity,
                    ease: "easeInOut",
                  }
            }
          />
        ))}

        {/* One-shot impact overlays */}
        <AnimatePresence>
          {action === "success" && (
            <>
              <motion.div
                key="success-burst"
                className="anime-burst absolute inset-0 z-20"
                initial={{ opacity: 0, scale: 0.7 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.22, ease: "easeOut" }}
              />
              <motion.div
                key="success-sheen"
                className="anime-sheen absolute inset-0 z-20"
                initial={{ opacity: 0, x: "-60%" }}
                animate={{ opacity: 0.9, x: "60%" }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.7, ease: "easeOut" }}
              />
            </>
          )}
          {action === "alert" && (
            <motion.div
              key="alert-flash"
              className="anime-alert-flash absolute inset-0 z-20"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
            />
          )}
        </AnimatePresence>

        {/* Character — no frame, no plate, just the figure and its aura. */}
        <motion.div
          className="relative z-10 flex h-[280px] items-end justify-center"
          animate={still ? undefined : motionSpec.animate}
          transition={still ? undefined : motionSpec.transition}
        >
          <NinjaArtwork
            variant={variant}
            className="h-full w-full origin-bottom scale-[1.12] object-contain"
            style={{
              filter:
                "drop-shadow(0 0 18px rgb(var(--brand-400) / 0.34)) drop-shadow(0 22px 26px rgb(0 0 0 / 0.62))",
            }}
          />
        </motion.div>

        <ActionProps action={action} still={still} />

        {/* A floating status chip replaces the old caption bar. */}
        <div className="relative z-30 mx-auto -mt-2 flex w-fit items-center gap-1.5 rounded-full border border-white/10 bg-surface-950/55 px-3 py-1 backdrop-blur-md">
          <span className={cn("h-1.5 w-1.5 rounded-full", caption.dot)} />
          <span className="text-[9px] font-semibold uppercase tracking-[0.16em] text-surface-300">
            {caption.label}
          </span>
        </div>
      </motion.div>
    </div>
  );
}

/**
 * Small drawn props that mime the action around the character: floating
 * documents while scanning, a rune ring while commanding, thought bubbles
 * while thinking, stars on success and a drawn alarm on danger.
 */
function ActionProps({ action, still }: { action: CompanionAction; still: boolean }) {
  const loop = (duration: number, delay = 0) =>
    still
      ? undefined
      : {
          duration,
          delay,
          repeat: Infinity,
          ease: "easeInOut" as const,
        };

  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      {action === "read" &&
        [0, 1, 2].map((index) => (
          <div
            key={`paper-${index}`}
            className="absolute"
            style={{
              right: 10 + index * 15,
              top: 112 - index * 16,
              width: 17,
              height: 22,
              transform: `rotate(${-12 + index * 8}deg)`,
            }}
          >
            <motion.div
              className="h-full w-full rounded-[2px] border border-brand-100/70 bg-surface-100/90 shadow-[0_6px_14px_rgba(0,0,0,0.35)]"
              animate={still ? undefined : { y: [0, -8, 0], opacity: [0.2, 0.9, 0.2] }}
              transition={loop(2.8, index * 0.4)}
            >
              <span className="absolute inset-x-1 top-1.5 h-px bg-brand-600/70" />
              <span className="absolute inset-x-1 top-3 h-px bg-brand-600/50" />
              <span className="absolute inset-x-1 top-[18px] h-px bg-brand-600/40" />
            </motion.div>
          </div>
        ))}

      {action === "write" && (
        <motion.div
          className="absolute right-0 top-28 h-20 w-20 rounded-full border border-brand-300/45"
          animate={still ? undefined : { rotate: 360 }}
          transition={
            still ? undefined : { duration: 9, repeat: Infinity, ease: "linear" }
          }
        >
          <span className="absolute -top-0.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-brand-200 shadow-[0_0_8px_rgb(var(--brand-300))]" />
          <span className="absolute -bottom-0.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-brand-400" />
          <span className="absolute -right-0.5 top-1/2 h-1 w-1 -translate-y-1/2 rounded-full bg-brand-300" />
          <span className="absolute -left-0.5 top-1/2 h-1 w-1 -translate-y-1/2 rounded-full bg-brand-500" />
        </motion.div>
      )}

      {action === "write" && (
        <motion.div
          className="absolute bottom-16 right-2 z-20"
          animate={still ? undefined : { y: [0, -4, 0], rotate: [0, -5, 0] }}
          transition={loop(1.8)}
        >
          <svg
            viewBox="0 0 24 40"
            className="h-11 w-7 drop-shadow-[0_3px_6px_rgba(0,0,0,0.5)]"
          >
            <path d="M20 2c-8 2-13 9-15 20l-2 8 5-3c10-4 15-12 14-22l-2-3Z" fill="#e2e8f0" />
            <path d="M8 28c6-5 9-11 10-18" stroke="#64748b" strokeWidth="0.9" fill="none" />
            <path d="M5 30l3-2 2 6-4 4-1-8Z" fill="#94a3b8" />
            <circle cx="21" cy="4" r="1.4" fill="#c7d2fe" />
          </svg>
          <motion.span
            className="absolute -left-1 bottom-1 h-1 w-1 rounded-full bg-brand-200"
            animate={still ? undefined : { opacity: [0, 1, 0], y: [0, 6, 12] }}
            transition={loop(1.2, 0.2)}
          />
        </motion.div>
      )}

      {action === "think" &&
        [0, 1, 2].map((index) => (
          <motion.span
            key={`thought-${index}`}
            className="absolute rounded-full border border-surface-300/40 bg-surface-100/85"
            style={{
              right: 16 + index * 5,
              top: 18 + index * 12,
              width: 5 + index * 4,
              height: 5 + index * 4,
            }}
            animate={still ? undefined : { opacity: [0.15, 0.9, 0.15], y: [0, -4, 0] }}
            transition={loop(2.2, index * 0.3)}
          />
        ))}

      {action === "success" && (
        <>
          {[
            { right: 18, top: 30, size: 10 },
            { right: 52, top: 20, size: 7 },
            { right: 30, top: 64, size: 6 },
            { left: 22, top: 36, size: 8 },
          ].map(({ size, ...position }, index) => (
            <motion.span
              key={`star-${index}`}
              className="absolute bg-brand-100"
              style={{
                ...position,
                width: size,
                height: 1.5,
                boxShadow: "0 0 6px rgb(var(--brand-200))",
              }}
              animate={
                still ? undefined : { opacity: [0, 1, 0], scale: [0.6, 1.2, 0.6] }
              }
              transition={loop(1.1, index * 0.12)}
            />
          ))}
        </>
      )}

      {action === "alert" && (
        <motion.span
          className="absolute right-6 top-8 z-20 text-2xl font-black italic text-red-300 drop-shadow-[0_2px_0_rgba(0,0,0,0.6)]"
          animate={still ? undefined : { scale: [1, 1.25, 1], opacity: [0.7, 1, 0.7] }}
          transition={loop(0.7)}
        >
          !
        </motion.span>
      )}
    </div>
  );
}
