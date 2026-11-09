"use client";

/**
 * Shared split-screen authentication scaffold.
 *
 * A themed equivalent of the premium login design reused by all four auth
 * pages (login / sign up fade, forgot password, reset password):
 *
 *   Left  — deep "stage" with the LIVE robot mascot: its eyes (and a hint
 *           of head tilt) follow the mouse anywhere on screen, it blinks on
 *           its own, and forms can drive moods through `useRobotStage()` —
 *           wink after a successful login, a bounce for good news, and a
 *           real drawn reaction (droopy eyes, frown, drooping antenna,
 *           startled shake) when something goes wrong. No emoji swapping:
 *           every reaction is rendered on the robot itself.
 *   Right — the active form panel. Colours come from `--brand-*` /
 *           `--surface-*` per `data-theme`; fantasy themes bleed their
 *           animated CSS backdrops through the semi-transparent layers.
 *
 * No page on this scaffold hard-codes an organization ID — sign-up flows
 * resolve the workspace from the public /auth/signup-options endpoint.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
  type MotionValue,
} from "framer-motion";

import { authApi } from "@/lib/api/auth";
import { cn } from "@/lib/utils/cn";
import { AmbientMotion } from "@/components/ui/AmbientMotion";
import type { PublicOrganization } from "@/types";

// ─── Robot stage — mood channel between the forms and the mascot ──────────

export type RobotMood = "idle" | "wink" | "happy" | "sad";

interface RobotStageValue {
  mood: RobotMood;
  /**
   * Show a mood briefly, then ease back to idle (error reactions, happy
   * bounces). Persistent moods survive the timer-less path via `holdMood`.
   */
  flashMood: (mood: RobotMood, durationMs?: number) => void;
  /**
   * Hold a mood with no auto-reset — used for the post-login wink, where
   * navigation unmounts the page anyway.
   */
  holdMood: (mood: RobotMood) => void;
}

const RobotStageContext = createContext<RobotStageValue | null>(null);

/** Drive the mascot from any auth form rendered inside `<AuthShell>`. */
export function useRobotStage(): RobotStageValue {
  const ctx = useContext(RobotStageContext);
  if (!ctx) {
    throw new Error("useRobotStage must be used inside <AuthShell>");
  }
  return ctx;
}

// ─── Public org picker (no more hard-coded organization UUIDs) ────────────

export interface SignupOptionsState {
  organizations: PublicOrganization[];
  /** First allowlisted organization — the default for sign-up forms. */
  defaultOrgId: string | null;
  isLoading: boolean;
  error: string | null;
}

const INITIAL_OPTIONS_STATE: SignupOptionsState = {
  organizations: [],
  defaultOrgId: null,
  isLoading: true,
  error: null,
};

export function useSignupOptions(): SignupOptionsState {
  const [state, setState] = useState<SignupOptionsState>(INITIAL_OPTIONS_STATE);

  useEffect(() => {
    let cancelled = false;
    authApi
      .signupOptions()
      .then((res) => {
        if (cancelled) return;
        const organizations = res.organizations ?? [];
        setState({
          organizations,
          defaultOrgId: organizations[0]?.id ?? null,
          isLoading: false,
          error: null,
        });
      })
      .catch(() => {
        if (cancelled) return;
        setState((prev) => ({
          ...prev,
          isLoading: false,
          error: "Could not reach the server. Check your connection and try again.",
        }));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

// ─── Shared style tokens (theme-variable driven) ──────────────────────────

/** Light-grey themed input with inner shadow and brand focus states. */
export const authInputClass = cn(
  "w-full rounded-xl border bg-surface-850/70 px-4 py-3 text-sm text-surface-100 outline-none",
  "shadow-[inset_0_1px_2px_rgb(var(--surface-950)/0.08)]",
  "placeholder:text-surface-500 transition-all duration-200",
  "hover:bg-surface-850 focus:bg-surface-900 focus:ring-4 focus:ring-brand-500/15",
  "focus:border-brand-500"
);

export const invalidInputClass = "border-red-500/60";

export const authLabelClass = "mb-1.5 block text-sm font-medium text-surface-200";

export const authErrorTextClass = "mt-1.5 text-xs text-red-400";

/** Full-width themed pill button. */
export const authPrimaryButtonClass = cn(
  "flex h-12 w-full items-center justify-center gap-2 rounded-full bg-brand-600 text-sm font-semibold text-white",
  "shadow-[0_1px_2px_rgb(var(--surface-950)/0.25),0_12px_32px_-14px_rgb(var(--brand-600)/0.65)]",
  "transition-all duration-200",
  "hover:-translate-y-px hover:bg-brand-500 hover:shadow-[0_2px_4px_rgb(var(--surface-950)/0.25),0_16px_38px_-14px_rgb(var(--brand-500)/0.75)]",
  "active:translate-y-0 active:scale-[0.99]",
  "focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-500/30",
  "disabled:cursor-not-allowed disabled:opacity-60"
);

/** Inline error / notice banner used across auth forms. */
export function AuthNotice({
  tone = "error",
  children,
}: {
  tone?: "error" | "success";
  children: React.ReactNode;
}) {
  return (
    <div
      role="alert"
      aria-live="polite"
      className={cn(
        "rounded-xl border px-4 py-3 text-sm",
        tone === "error"
          ? "border-red-500/30 bg-red-500/10 text-red-400"
          : "border-brand-500/30 bg-brand-500/10 text-brand-300"
      )}
    >
      {children}
    </div>
  );
}

// ─── Scaffold: mascot stage + form panel ──────────────────────────────────

const FLOAT_EASE = [0.45, 0, 0.55, 1] as const;
/** Default lifetime for flashed moods before easing back to idle. */
const MOOD_FLASH_MS = 1800;

export function AuthShell({ children }: { children: React.ReactNode }) {
  const [mood, setMoodState] = useState<RobotMood>("idle");
  const moodTimer = useRef<number | undefined>(undefined);

  const flashMood = useCallback((next: RobotMood, durationMs = MOOD_FLASH_MS) => {
    window.clearTimeout(moodTimer.current);
    setMoodState(next);
    moodTimer.current = window.setTimeout(() => setMoodState("idle"), durationMs);
  }, []);

  const holdMood = useCallback((next: RobotMood) => {
    window.clearTimeout(moodTimer.current);
    setMoodState(next);
  }, []);

  // Clear any pending reset when the shell unmounts (route change).
  useEffect(() => () => window.clearTimeout(moodTimer.current), []);

  const stage = useMemo<RobotStageValue>(
    () => ({ mood, flashMood, holdMood }),
    [mood, flashMood, holdMood]
  );

  const reducedMotionValue = useReducedMotion();
  // Media queries are unreadable during SSR. Gating on `mounted` keeps the
  // first client render identical to the server HTML, so reduced-motion
  // users get frozen animations *after* hydration instead of a hydration
  // failure that drops the whole server DOM.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const prefersReduced = mounted && reducedMotionValue === true;

  return (
    <RobotStageContext.Provider value={stage}>
      <main
        className="relative grid min-h-screen w-full grid-cols-1 overflow-hidden bg-surface-950 text-surface-100 lg:grid-cols-2"
      >
        {/* Pointer-reactive orbs + perspective floor, tinted per theme. */}
        <AmbientMotion className="absolute inset-0 z-0" />

        {/* ── Left stage — themed animated mascot ───────────────────────── */}
        <div
          aria-hidden="true"
          className={cn(
            "relative z-10 hidden items-center justify-center overflow-hidden lg:flex",
            // The translucent canvas lets the theme's ambient layers drift
            // through the stage without touching the form panel.
            "bg-surface-950"
          )}
        >
          {/* Ambient glow behind the mascot, tinted by the active theme */}
          <motion.div
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{
              width: 540,
              height: 540,
              background:
                "radial-gradient(circle, rgb(var(--brand-500) / 0.16) 0%, rgb(var(--brand-500) / 0.07) 42%, transparent 70%)",
            }}
            animate={
              prefersReduced
                ? undefined
                : { scale: [1, 1.12, 1], opacity: [0.85, 1, 0.85] }
            }
            transition={
              prefersReduced
                ? undefined
                : { duration: 7, repeat: Infinity, ease: "easeInOut" }
            }
          />

          <SparkField prefersReduced={prefersReduced} />

          {/* The mascot + its shadow share one float timeline */}
          <div className="relative flex flex-col items-center">
            <motion.div
              animate={
                prefersReduced
                  ? undefined
                  : { y: [0, -16, 0], rotate: [0, 1.6, -1.2, 0] }
              }
              transition={
                prefersReduced
                  ? undefined
                  : { duration: 6.5, repeat: Infinity, ease: FLOAT_EASE }
              }
              className="drop-shadow-[0_0_38px_rgb(var(--brand-400)/0.4)] text-brand-400"
            >
              {/* Mood reaction layer — lives above the endless idle float
                  so each mood plays exactly once, in clean isolation. */}
              <motion.div
                animate={
                  prefersReduced
                    ? undefined
                    : mood === "sad"
                      ? // Startled shake + slight drop of the shoulders.
                        { x: [0, -9, 8, -5, 3, 0], y: [0, 7, 5, 7, 6, 0] }
                      : mood === "happy"
                        ? { y: [0, -24, 0], scaleY: [1, 0.94, 1.04, 1] }
                        : mood === "wink"
                          ? { rotate: [0, -6, 4, 0], y: [0, -10, 0] }
                          : undefined
                }
                transition={
                  prefersReduced
                    ? undefined
                    : mood === "sad"
                      ? { duration: 0.6, ease: "easeOut" }
                      : { duration: 0.8, ease: FLOAT_EASE }
                }
              >
                <LiveRobot mood={mood} trackMouse={!prefersReduced} />
              </motion.div>
            </motion.div>

            {/* Soft themed ground shadow — squashes with the mood */}
            <motion.div
              className="mt-3 h-5 w-44 rounded-[100%] bg-brand-400/25 blur-xl"
              animate={
                prefersReduced
                  ? undefined
                  : mood === "sad"
                    ? { scaleX: 0.7, opacity: 0.2 }
                    : mood === "happy" || mood === "wink"
                      ? { scaleX: [1, 0.74, 1], opacity: [0.5, 0.28, 0.5] }
                      : { scaleX: [1, 0.82, 1], opacity: [0.5, 0.3, 0.5] }
              }
              transition={
                prefersReduced
                  ? undefined
                  : mood === "sad"
                    ? { duration: 0.4, ease: "easeOut" }
                    : { duration: 6.5, repeat: Infinity, ease: FLOAT_EASE }
              }
            />
          </div>

          {/* Wordmark */}
          <p className="absolute bottom-8 left-8 text-[13px] font-semibold tracking-[0.32em] text-surface-500">
            FIKRA&nbsp;AI
          </p>
        </div>

        {/* ── Right panel — themed form surface ─────────────────────────── */}
        <section
          className={cn(
            "relative z-10 flex min-h-screen items-center justify-center px-6 py-12 sm:px-10",
            "bg-surface-900/80 backdrop-blur-2xl",
            "border-l border-surface-800/40"
          )}
        >
          {children}
        </section>
      </main>
    </RobotStageContext.Provider>
  );
}

/** Sparse themed sparks, gently pulsing. */
function SparkField({ prefersReduced }: { prefersReduced: boolean }) {
  const sparks = [
    { top: "20%", left: "14%", size: 3, delay: 0 },
    { top: "26%", left: "80%", size: 2, delay: 1.1 },
    { top: "72%", left: "20%", size: 2, delay: 2.3 },
    { top: "78%", left: "76%", size: 3, delay: 0.6 },
    { top: "14%", left: "52%", size: 2, delay: 1.8 },
  ] as const;
  return (
    <>
      {sparks.map((s, i) => (
        <motion.span
          key={i}
          className="absolute rounded-full bg-brand-300/70"
          style={{ top: s.top, left: s.left, width: s.size, height: s.size }}
          animate={prefersReduced ? undefined : { opacity: [0.15, 0.7, 0.15] }}
          transition={
            prefersReduced
              ? undefined
              : { duration: 4.2, repeat: Infinity, delay: s.delay, ease: "easeInOut" }
          }
        />
      ))}
    </>
  );
}

// ─── The live robot ───────────────────────────────────────────────────────

/**
 * The interactive mascot SVG.
 *
 * - Eyes (and a subtle head tilt) track the mouse across the whole screen,
 *   softened by springs so it "notices" rather than snaps.
 * - Automatic blink loop — disabled for reduced-motion users.
 * - Moods redraw the face itself: `wink` closes one eye with a smug smile,
 *   `happy` widens the grin, `sad` droops the eyes into arcs, flips the
 *   smile into a frown, and lets the antenna sag. All drawn, never emoji.
 */
const ROBOT_VIEW_SIZE = { W: 220, H: 240 } as const;

function LiveRobot({
  mood,
  trackMouse,
}: {
  mood: RobotMood;
  trackMouse: boolean;
}) {
  // Normalised pointer position over the viewport: -1 … 1 on both axes.
  const pointerX = useMotionValue(0);
  const pointerY = useMotionValue(0);

  useEffect(() => {
    if (!trackMouse) return;
    const onMove = (e: MouseEvent) => {
      pointerX.set((e.clientX / window.innerWidth) * 2 - 1);
      pointerY.set((e.clientY / window.innerHeight) * 2 - 1);
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, [trackMouse, pointerX, pointerY]);

  // Springs make the robot "notice" the cursor instead of snapping to it.
  const pupilX = useSpring(useTransform(pointerX, [-1, 1], [-7.5, 7.5]), {
    stiffness: 220,
    damping: 22,
  });
  const pupilY = useSpring(useTransform(pointerY, [-1, 1], [-3, 5]), {
    stiffness: 220,
    damping: 22,
  });
  // Head tilt follows the horizontal pointer slightly.
  const headTilt = useSpring(useTransform(pointerX, [-1, 1], [-4, 4]), {
    stiffness: 140,
    damping: 24,
  });
  // Whole-body 3D tilt: the robot leans in the direction of the pointer.
  const tiltX = useSpring(useTransform(pointerY, [-1, 1], [6, -6]), {
    stiffness: 90,
    damping: 22,
  });
  const tiltY = useSpring(useTransform(pointerX, [-1, 1], [-9, 9]), {
    stiffness: 90,
    damping: 22,
  });
  // Orbital rings spin continuously; the dashed one counter-rotates.
  const reducedMotion = useReducedMotion();
  const orbit = reducedMotion === true ? undefined : { rotate: 360 };
  const orbitTransition =
    reducedMotion === true
      ? undefined
      : { duration: 26, repeat: Infinity, ease: "linear" as const };

  return (
    <div className="relative flex items-center justify-center">
      {/* Orbital energy rings — a 3D cue that keeps the stage moving. */}
      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -m-10 rounded-full border border-brand-400/20"
        animate={orbit}
        transition={orbitTransition}
        style={{ borderTopColor: "rgb(var(--brand-300) / 0.55)" }}
      />
      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -m-20 rounded-full border border-dashed border-brand-500/15"
        animate={orbit ? { rotate: -360 } : undefined}
        transition={orbitTransition}
      />
      <motion.span
        aria-hidden="true"
        className="pointer-events-none absolute -right-16 top-6 h-2.5 w-2.5 rounded-full bg-brand-300"
        animate={
          orbit
            ? { opacity: [0.2, 0.9, 0.2], scale: [0.8, 1.25, 0.8], y: [0, -8, 0] }
            : undefined
        }
        transition={orbit ? { duration: 4.2, repeat: Infinity, ease: "easeInOut" } : undefined}
      />
      <motion.span
        aria-hidden="true"
        className="pointer-events-none absolute -left-14 bottom-14 h-1.5 w-1.5 rounded-full bg-brand-200"
        animate={
          orbit
            ? { opacity: [0.15, 0.8, 0.15], scale: [0.7, 1.3, 0.7] }
            : undefined
        }
        transition={orbit ? { duration: 3.4, repeat: Infinity, ease: "easeInOut", delay: 0.8 } : undefined}
      />

      <motion.div
        style={{
          rotateX: tiltX,
          rotateY: tiltY,
          transformPerspective: 900,
          transformStyle: "preserve-3d",
        }}
      >
        <svg
          width="272"
          height="300"
          viewBox={`0 0 ${ROBOT_VIEW_SIZE.W} ${ROBOT_VIEW_SIZE.H}`}
          fill="none"
          stroke="currentColor"
          strokeWidth={2.6}
          strokeLinecap="round"
          strokeLinejoin="round"
          role="img"
        >
          <defs>
            <linearGradient id="robot-visor" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="currentColor" stopOpacity="0.16" />
              <stop offset="1" stopColor="currentColor" stopOpacity="0.02" />
            </linearGradient>
          </defs>

          {/* Antenna — sags when the robot is sad */}
          <motion.g
            animate={{ rotate: mood === "sad" ? 26 : 0 }}
            transition={{ type: "spring", stiffness: 120, damping: 12 }}
            style={{
              transformBox: "fill-box",
              transformOrigin: "60% 100%",
            }}
          >
            <line x1="110" y1="30" x2="110" y2="16" />
            <circle cx="110" cy="12" r="4.5" fill="currentColor" stroke="none" />
          </motion.g>

          {/* Head — tilts subtly toward the pointer (transform origin = neck) */}
          <motion.g
            style={{
              rotate: headTilt,
              transformBox: "fill-box",
              transformOrigin: "50% 100%",
            }}
          >
            <rect x="60" y="30" width="100" height="76" rx="24" />
            {/* Visor with a soft inner light */}
            <rect x="74" y="46" width="72" height="34" rx="17" />
            <rect
              x="76"
              y="48"
              width="68"
              height="30"
              rx="15"
              fill="url(#robot-visor)"
              stroke="none"
            />

            <RobotFace mood={mood} pupilX={pupilX} pupilY={pupilY} blinkDisabled={!trackMouse} />
          </motion.g>

          {/* Ear pods */}
          <line x1="44" y1="62" x2="60" y2="62" />
          <line x1="160" y1="62" x2="176" y2="62" />
          <circle cx="40" cy="62" r="4.5" />
          <circle cx="180" cy="62" r="4.5" />

          {/* Neck */}
          <line x1="102" y1="106" x2="102" y2="118" />
          <line x1="118" y1="106" x2="118" y2="118" />

          {/* Torso */}
          <path d="M84 118 h52 a26 26 0 0 1 26 26 v40 a26 26 0 0 1 -26 26 h-52 a26 26 0 0 1 -26 -26 v-40 a26 26 0 0 1 26 -26 z" />

          {/* Chest core */}
          <circle cx="110" cy="164" r="13.5" />
          <motion.circle
            cx="110"
            cy="164"
            r="4.6"
            fill="currentColor"
            stroke="none"
            animate={mood === "sad" ? { opacity: [1, 0.25, 1] } : undefined}
            transition={
              mood === "sad"
                ? { duration: 0.9, repeat: Infinity, ease: "easeInOut" }
                : undefined
            }
          />

          {/* Chest accents */}
          <line x1="86" y1="130" x2="82" y2="134" />
          <line x1="82" y1="130" x2="86" y2="134" />
          <line x1="134" y1="130" x2="138" y2="134" />
          <line x1="138" y1="130" x2="134" y2="134" />

          {/* Arms */}
          <path d="M58 138 L36 154" />
          <circle cx="32" cy="158" r="6" />
          <path d="M162 138 L184 154" />
          <circle cx="188" cy="158" r="6" />

          {/* Legs */}
          <path d="M93 210 v16" />
          <path d="M127 210 v16" />
          <path d="M85 232 h16" />
          <path d="M119 232 h16" />
        </svg>
      </motion.div>
    </div>
  );
}

/**
 * Face detail per mood. Open eyes stay mounted across moods so the springy
 * pupil tracking never resets; closed-eye moods swap in drawn arcs.
 */
function RobotFace({
  mood,
  pupilX,
  pupilY,
  blinkDisabled,
}: {
  mood: RobotMood;
  pupilX: MotionValue<number>;
  pupilY: MotionValue<number>;
  blinkDisabled: boolean;
}) {
  if (mood === "sad") {
    return (
      <>
        {/* Drooping eye arcs (bulge downward = sadness) */}
        <path d="M89 61 Q97 69 105 61" strokeWidth={2.4} />
        <path d="M115 61 Q123 69 131 61" strokeWidth={2.4} />
        {/* Frown */}
        <path d="M99 95 Q110 86 121 95" strokeWidth={2.2} />
      </>
    );
  }

  if (mood === "wink") {
    return (
      <>
        {/* Left eye closed with a happy upward arc … */}
        <path d="M89 67 Q97 58 105 67" strokeWidth={2.4} />
        {/* … while the right eye keeps following the mouse */}
        <motion.circle
          cx={123}
          cy={63}
          r={4.2}
          fill="currentColor"
          stroke="none"
          style={{ x: pupilX, y: pupilY }}
        />
        {/* Smug wide grin */}
        <path d="M96 86 Q110 100 124 87" strokeWidth={2.2} />
      </>
    );
  }

  // idle / happy — both eyes open, pupils tracking the cursor
  return (
    <>
      <motion.g
        // Natural blink loop, unless the user prefers reduced motion.
        animate={blinkDisabled ? undefined : { scaleY: [1, 1, 0.08, 1, 1] }}
        transition={
          blinkDisabled
            ? undefined
            : { duration: 4.6, times: [0, 0.42, 0.48, 0.54, 1], repeat: Infinity }
        }
        style={{ transformBox: "fill-box", transformOrigin: "50% 50%" }}
      >
        <motion.circle
          cx={97}
          cy={63}
          r={4.2}
          fill="currentColor"
          stroke="none"
          style={{ x: pupilX, y: pupilY }}
        />
        <motion.circle
          cx={123}
          cy={63}
          r={4.2}
          fill="currentColor"
          stroke="none"
          style={{ x: pupilX, y: pupilY }}
        />
      </motion.g>
      {/* smile — a touch wider on happy */}
      <path
        d={mood === "happy" ? "M95 85 Q110 101 125 86" : "M99 88 Q110 95 121 88"}
        strokeWidth={2.2}
      />
    </>
  );
}

/** Themed monochrome wordmark glyph for form headers. */
export function LogoMark() {
  return (
    <span
      className={cn(
        "flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-600 text-white",
        "shadow-[0_10px_28px_-12px_rgb(var(--brand-600)/0.65)]"
      )}
    >
      <RobotBurst />
      <span className="sr-only">FIKRA AI</span>
    </span>
  );
}

/** Tiny geometric spark used inside the logo tile. */
function RobotBurst() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path d="M10 1.5 11.8 7 17 9l-5.2 2L10 16.5 8.2 11 3 9l5.2-2L10 1.5z" />
      <circle cx="16" cy="16" r="1.4" opacity="0.7" />
      <circle cx="4" cy="15" r="1" opacity="0.5" />
    </svg>
  );
}

// ─── Social sign-in buttons (OAuth launches later; inline notice for now) ─

const SOCIAL_NOTICE =
  "Social sign-in launches soon — use your email for now.";

export function SocialButtons({
  onNotify,
}: {
  onNotify: (message: string) => void;
}) {
  const buttons = [
    { key: "google", label: "Continue with Google", Icon: GoogleIcon },
    { key: "apple", label: "Continue with Apple", Icon: AppleIcon },
    { key: "x", label: "Continue with X", Icon: XIcon },
  ] as const;

  return (
    <>
      <div aria-hidden="true" className="my-6 flex items-center gap-4">
        <span className="h-px flex-1 bg-surface-700/60" />
        <span className="text-xs font-medium uppercase tracking-widest text-surface-500">
          Or
        </span>
        <span className="h-px flex-1 bg-surface-700/60" />
      </div>

      <div className="grid grid-cols-3 gap-3">
        {buttons.map(({ key, label, Icon }) => (
          <button
            key={key}
            type="button"
            title="Social sign-in is not configured for this workspace yet."
            aria-label={label}
            className={cn(
              "flex h-11 items-center justify-center rounded-xl border border-surface-700/60 bg-surface-900/70 text-surface-300",
              "shadow-[0_1px_2px_rgb(var(--surface-950)/0.08)] transition-all duration-200",
              "hover:-translate-y-px hover:border-brand-400/70 hover:text-surface-100 hover:shadow-[0_4px_12px_-4px_rgb(var(--brand-400)/0.25)]",
              "active:translate-y-0 active:scale-95",
              "focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-500/20"
            )}
            onClick={() => onNotify(SOCIAL_NOTICE)}
          >
            <Icon />
          </button>
        ))}
      </div>
    </>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true">
      <path d="M21.35 11.1h-9.17v2.73h6.51c-.33 3.81-3.5 5.44-6.5 5.44C8.36 19.27 5 16.27 5 12c0-4.1 3.2-7.27 7.2-7.27 3.09 0 4.9 1.97 4.9 1.97L19 4.72S16.05 2 11.95 2C6.35 2 2 6.55 2 12c0 5.3 4.15 10 9.95 10 5.85 0 9.65-4.1 9.4-9.9z" />
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true">
      <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.53 4.08ZM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}
