"use client";

/**
 * AmbientMotion — theme-aware motion graphics that live behind page content.
 *
 * Every palette gets the same three layers, tinted by its own `--brand-*`
 * variables: drifting light orbs that parallax with the pointer, a slow
 * perspective grid that reads as a 3D floor, and a handful of floating motes.
 * Fantasy themes still paint their richer particle fields from CSS; this layer
 * simply guarantees that no theme feels static.
 */

import { useEffect, useRef, useState } from "react";
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "framer-motion";
import { cn } from "@/lib/utils/cn";

export function AmbientMotion({ className }: { className?: string }) {
  const reducedMotionValue = useReducedMotion();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const prefersReduced = mounted && reducedMotionValue === true;

  const pointerX = useMotionValue(0);
  const pointerY = useMotionValue(0);

  useEffect(() => {
    if (prefersReduced) return;
    const onMove = (event: MouseEvent) => {
      pointerX.set((event.clientX / window.innerWidth) * 2 - 1);
      pointerY.set((event.clientY / window.innerHeight) * 2 - 1);
    };
    window.addEventListener("mousemove", onMove, { passive: true });
    return () => window.removeEventListener("mousemove", onMove);
  }, [prefersReduced, pointerX, pointerY]);

  const orbX = useSpring(useTransform(pointerX, [-1, 1], [-26, 26]), {
    stiffness: 60,
    damping: 24,
  });
  const orbY = useSpring(useTransform(pointerY, [-1, 1], [-18, 18]), {
    stiffness: 60,
    damping: 24,
  });
  const orbXOpposite = useSpring(useTransform(pointerX, [-1, 1], [20, -20]), {
    stiffness: 48,
    damping: 26,
  });
  const orbYOpposite = useSpring(useTransform(pointerY, [-1, 1], [14, -14]), {
    stiffness: 48,
    damping: 26,
  });

  const motes = useRef(
    Array.from({ length: 9 }, (_, index) => ({
      left: `${8 + ((index * 37) % 84)}%`,
      top: `${12 + ((index * 53) % 72)}%`,
      size: index % 3 === 0 ? 3 : 2,
      delay: (index * 0.73) % 4,
      duration: 6 + (index % 4) * 1.4,
    }))
  ).current;

  return (
    <div
      aria-hidden="true"
      className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}
    >
      {/* Parallax light orbs — the palette's own accent colours. */}
      <div className="fx-ribbon" />
      <motion.div
        className="absolute -left-24 top-0 h-[34rem] w-[34rem] rounded-full opacity-70 blur-[110px]"
        style={{
          x: orbX,
          y: orbY,
          background:
            "radial-gradient(circle, rgb(var(--orb-a) / 0.3), rgb(var(--orb-a) / 0.1) 48%, transparent 72%)",
        }}
        animate={prefersReduced ? undefined : { scale: [1, 1.12, 1] }}
        transition={prefersReduced ? undefined : { duration: 18, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="absolute -right-28 bottom-[-12rem] h-[38rem] w-[38rem] rounded-full opacity-60 blur-[130px]"
        style={{
          x: orbXOpposite,
          y: orbYOpposite,
          background:
            "radial-gradient(circle, rgb(var(--orb-b) / 0.26), rgb(var(--orb-b) / 0.08) 50%, transparent 74%)",
        }}
        animate={prefersReduced ? undefined : { scale: [1.05, 1.18, 1.05] }}
        transition={prefersReduced ? undefined : { duration: 24, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="absolute left-[38%] top-[34%] h-[28rem] w-[28rem] rounded-full opacity-40 blur-[120px]"
        style={{
          x: orbXOpposite,
          y: orbY,
          background:
            "radial-gradient(circle, rgb(var(--orb-c) / 0.24), transparent 70%)",
        }}
        animate={prefersReduced ? undefined : { scale: [0.96, 1.1, 0.96], opacity: [0.32, 0.5, 0.32] }}
        transition={prefersReduced ? undefined : { duration: 30, repeat: Infinity, ease: "easeInOut" }}
      />

      {/* 3D perspective floor — indigo/violet grid recedes toward the horizon. */}
      <div className="fx-grid-3d" />

      {/* Floating motes */}
      <div className="absolute inset-0">
        {motes.map((mote, index) => (
          <motion.span
            key={index}
            className="absolute rounded-full bg-brand-300/60"
            style={{
              left: mote.left,
              top: mote.top,
              width: mote.size,
              height: mote.size,
              boxShadow: "0 0 8px rgb(var(--brand-400) / 0.55)",
            }}
            animate={
              prefersReduced
                ? undefined
                : { opacity: [0.12, 0.66, 0.12], y: [0, -18, 0] }
            }
            transition={
              prefersReduced
                ? undefined
                : { duration: mote.duration, delay: mote.delay, repeat: Infinity, ease: "easeInOut" }
            }
          />
        ))}
      </div>
    </div>
  );
}
