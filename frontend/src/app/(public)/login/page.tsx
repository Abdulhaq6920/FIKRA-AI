"use client";

/**
 * Authentication — premium themed split-screen with sign-in / sign-up modes.
 *
 * Left:  themed "stage" with the floating robot mascot (see AuthShell).
 * Right: one panel that the two forms slide between — clicking "Sign Up"
 *        slides the login form out to the left and serves the registration
 *        form in its place from the right, with the mascot staying put.
 *        The URL follows the mode ("/login?mode=signup") so deep links and
 *        the legacy /register route land on the right form, without any
 *        full-page navigation (history.replaceState keeps the animation).
 *
 * Business logic is untouched: react-hook-form + Zod, AuthContext.login(),
 * and the organization_id resolved from /auth/signup-options (never
 * hard-coded).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  loginSchema,
  registerSchema,
  type LoginFormData,
  type RegisterFormData,
} from "@/lib/validation/schemas";
import { useAuth } from "@/features/auth/AuthContext";
import { authApi } from "@/lib/api/auth";
import {
  AuthNotice,
  AuthShell,
  authErrorTextClass,
  authInputClass,
  authLabelClass,
  authPrimaryButtonClass,
  invalidInputClass,
  LogoMark,
  SocialButtons,
  useRobotStage,
  useSignupOptions,
} from "@/features/auth/AuthShell";
import { ApiRequestError } from "@/lib/api/client";
import { cn } from "@/lib/utils/cn";

type AuthMode = "login" | "signup";
/** Slide direction: +1 → signup enters from the right, −1 → back to login. */
type SlideDirection = 1 | -1;

export default function LoginPage() {
  const [mode, setMode] = useState<AuthMode>("login");
  const [slideDirection, setSlideDirection] = useState<SlideDirection>(1);
  /** Success notice shown right after an in-page account creation. */
  const [registeredEmail, setRegisteredEmail] = useState<string | null>(null);
  /** Mirror of `mode` so callbacks can read it without stale updates. */
  const modeRef = useRef<AuthMode>("login");

  const mounted = useRef(false);
  useEffect(() => {
    if (mounted.current) return;
    mounted.current = true;
    // Deep links: /login?mode=signup opens the sign-up slide directly.
    // (Direct window read avoids a Suspense boundary for useSearchParams.)
    const params = new URLSearchParams(window.location.search);
    const initialMode = params.get("mode") === "signup" ? "signup" : "login";
    if (initialMode === "signup") {
      modeRef.current = "signup";
      setMode("signup");
      setSlideDirection(1);
    }
    // Legacy "?registered=1" entry point: the success banner is now replaced
    // by autofilling the verified email in the sign-in form.
  }, []);

  const switchMode = useCallback((next: AuthMode) => {
    if (modeRef.current === next) return;
    modeRef.current = next;
    // Both updates live outside the setState updater: React may invoke an
    // updater twice (StrictMode), and side effects there would double-fire.
    setSlideDirection(next === "signup" ? 1 : -1);
    window.history.replaceState(
      null,
      "",
      next === "signup" ? "/login?mode=signup" : "/login"
    );
    setMode(next);
  }, []);

  const handleRegistered = useCallback(
    (email: string) => {
      setRegisteredEmail(email);
      switchMode("login");
    },
    [switchMode]
  );

  return (
    <AuthShell>
      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-[400px]"
      >
        <div className="text-center">
          <span className="inline-flex items-center justify-center">
            <LogoMark />
          </span>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={mode}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.22 }}
            >
              <h1
                id="auth-heading"
                className="mt-5 text-3xl font-bold tracking-tight text-surface-100 sm:text-4xl"
              >
                {mode === "login" ? "Welcome back!" : "Create account"}
              </h1>
              <p className="mt-2 text-sm text-surface-400">
                {mode === "login"
                  ? "Enter your login details"
                  : "Join FIKRA AI in a few seconds"}
              </p>
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Both forms live here and slide horizontally */}
        <div className="mt-8 overflow-hidden">
          <AnimatePresence mode="wait" custom={slideDirection} initial={false}>
            {mode === "login" ? (
              <motion.div
                key="login"
                custom={slideDirection}
                variants={slideVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
              >
                <LoginForm
                  registeredEmail={registeredEmail}
                  onClearRegistered={() => setRegisteredEmail(null)}
                  onSwitchToSignUp={() => switchMode("signup")}
                />
              </motion.div>
            ) : (
              <motion.div
                key="signup"
                custom={slideDirection}
                variants={slideVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
              >
                <SignupForm
                  onRegistered={handleRegistered}
                  onSwitchToSignIn={() => switchMode("login")}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </AuthShell>
  );
}

/** Directional slide: outgoing form leaves left, incoming arrives from right. */
const slideVariants = {
  enter: (dir: SlideDirection) => ({ opacity: 0, x: 48 * dir }),
  center: { opacity: 1, x: 0 },
  exit: (dir: SlideDirection) => ({ opacity: 0, x: -48 * dir }),
};

// ─── Sign-in form ──────────────────────────────────────────────────────────

function LoginForm({
  registeredEmail,
  onClearRegistered,
  onSwitchToSignUp,
}: {
  registeredEmail: string | null;
  onClearRegistered: () => void;
  onSwitchToSignUp: () => void;
}) {
  const { login } = useAuth();
  const [showPassword, setShowPassword] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const { defaultOrgId, isLoading: orgsLoading } = useSignupOptions();
  const { flashMood, holdMood } = useRobotStage();

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: { organization_id: undefined as unknown as string },
  });

  // Fill the workspace ID once the public org list resolves.
  useEffect(() => {
    if (defaultOrgId) setValue("organization_id", defaultOrgId);
  }, [defaultOrgId, setValue]);

  // Autofill the email a user just registered with.
  useEffect(() => {
    if (registeredEmail) {
      setValue("email", registeredEmail);
      onClearRegistered();
    }
  }, [registeredEmail, onClearRegistered, setValue]);

  const onSubmit = async (data: LoginFormData) => {
    setServerError(null);
    // Wink on success; navigation pauses briefly (successDelayMs) so the
    // mascot's celebration is actually visible before the route changes.
    holdMood("wink");
    try {
      await login(data, { successDelayMs: 1500 });
    } catch (err) {
      flashMood("sad");
      if (err instanceof ApiRequestError && err.status === 401) {
        setServerError("Invalid email or password. Please try again.");
      } else if (err instanceof ApiRequestError) {
        setServerError(err.message || "Something went wrong. Please try again.");
      } else {
        setServerError("Something went wrong. Please try again.");
      }
    }
  };

  return (
    <form
      onSubmit={handleSubmit(onSubmit, () => flashMood("sad", 1400))}
      noValidate
      aria-label="Sign in form"
    >
      {/* Email */}
      <div>
        <label htmlFor="email" className={authLabelClass}>
          Email
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          placeholder="you@company.com"
          className={cn(authInputClass, errors.email && invalidInputClass)}
          aria-invalid={!!errors.email}
          aria-describedby={errors.email ? "email-error" : undefined}
          {...register("email")}
        />
        {errors.email && (
          <p id="email-error" className={authErrorTextClass} role="alert">
            {errors.email.message}
          </p>
        )}
      </div>

      {/* Password */}
      <div className="mt-4">
        <label htmlFor="password" className={authLabelClass}>
          Password
        </label>
        <div className="relative">
          <input
            id="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            placeholder="••••••••"
            className={cn(authInputClass, "pr-11", errors.password && invalidInputClass)}
            aria-invalid={!!errors.password}
            aria-describedby={errors.password ? "password-error" : undefined}
            {...register("password")}
          />
          <button
            type="button"
            onClick={() => setShowPassword((p) => !p)}
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-surface-400 transition-colors hover:text-surface-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
            aria-label={showPassword ? "Hide password" : "Show password"}
            aria-pressed={showPassword}
          >
            {showPassword ? (
              <EyeOff className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Eye className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        </div>
        {errors.password && (
          <p id="password-error" className={authErrorTextClass} role="alert">
            {errors.password.message}
          </p>
        )}
      </div>

      {/* Hidden workspace ID resolved from the public signup-options endpoint */}
      <input type="hidden" {...register("organization_id")} />

      {/* Remember / forgot row */}
      <div className="mt-6 flex items-center justify-between">
        <label htmlFor="remember-me" className="flex cursor-pointer select-none items-center gap-2 text-sm text-surface-400">
          <input
            id="remember-me"
            type="checkbox"
            name="remember-me"
            className="h-4 w-4 cursor-pointer rounded border-surface-600 bg-surface-900 accent-brand-600 focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:ring-offset-0"
          />
          <span className="transition-colors has-[:checked]:text-surface-100">Remember me</span>
        </label>
        <Link
          href="/forgot-password"
          className="text-sm font-medium text-surface-200 underline-offset-4 transition-colors hover:text-brand-400 focus:outline-none focus-visible:underline"
        >
          Forgot password?
        </Link>
      </div>

      {serverError && (
        <div className="mt-5">
          <AuthNotice>{serverError}</AuthNotice>
        </div>
      )}

      {/* Submit */}
      <button
        type="submit"
        disabled={isSubmitting || orgsLoading || !defaultOrgId}
        className={cn(authPrimaryButtonClass, "mt-6")}
      >
        {(isSubmitting || orgsLoading) && (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        )}
        {isSubmitting ? "Signing in…" : "Log in"}
      </button>

      <SocialButtons
        onNotify={(message) => {
          setServerError(message);
          flashMood("sad", 1400);
        }}
      />

      {/* Switch to sign-up (slides the panel) */}
      <p className="mt-8 text-center text-sm text-surface-400">
        Don&apos;t have an account?{" "}
        <button
          type="button"
          onClick={onSwitchToSignUp}
          className="font-semibold text-surface-100 underline-offset-4 transition-colors hover:text-brand-400 focus:outline-none focus-visible:underline"
        >
          Sign Up
        </button>
      </p>
    </form>
  );
}

// ─── Sign-up form ──────────────────────────────────────────────────────────

function SignupForm({
  onRegistered,
  onSwitchToSignIn,
}: {
  onRegistered: (email: string) => void;
  onSwitchToSignIn: () => void;
}) {
  const { defaultOrgId, isLoading: orgsLoading, error: orgsError } = useSignupOptions();
  const { flashMood } = useRobotStage();
  const [showPassword, setShowPassword] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
    defaultValues: { organization_id: undefined as unknown as string },
  });

  useEffect(() => {
    if (defaultOrgId) setValue("organization_id", defaultOrgId);
  }, [defaultOrgId, setValue]);

  const onSubmit = async (data: RegisterFormData) => {
    setServerError(null);
    try {
      // The endpoint answers 201 for both new accounts and already-registered
      // emails (anti-enumeration), so always guide the user to sign in.
      await authApi.register(data);
      flashMood("happy"); // celebratory bounce while the panel slides back
      onRegistered(data.email);
    } catch (err) {
      flashMood("sad", 2200);
      if (err instanceof ApiRequestError && err.status === 403) {
        setServerError("This workspace doesn't accept public sign-ups. Ask your workspace admin for an invite.");
      } else if (err instanceof ApiRequestError) {
        setServerError(err.message);
      } else {
        setServerError("Registration failed. Please try again.");
      }
    }
  };

  return (
    <form
      onSubmit={handleSubmit(onSubmit, () => flashMood("sad", 1400))}
      noValidate
      aria-label="Sign up form"
    >
      {/* Full name */}
      <div>
        <label htmlFor="full_name" className={authLabelClass}>
          Full name
        </label>
        <input
          id="full_name"
          type="text"
          autoComplete="name"
          placeholder="Jane Smith"
          className={cn(authInputClass, errors.full_name && invalidInputClass)}
          aria-invalid={!!errors.full_name}
          aria-describedby={errors.full_name ? "full_name-error" : undefined}
          {...register("full_name")}
        />
        {errors.full_name && (
          <p id="full_name-error" className={authErrorTextClass} role="alert">
            {errors.full_name.message}
          </p>
        )}
      </div>

      {/* Email */}
      <div className="mt-4">
        <label htmlFor="signup-email" className={authLabelClass}>
          Email
        </label>
        <input
          id="signup-email"
          type="email"
          autoComplete="email"
          placeholder="you@company.com"
          className={cn(authInputClass, errors.email && invalidInputClass)}
          aria-invalid={!!errors.email}
          aria-describedby={errors.email ? "signup-email-error" : undefined}
          {...register("email")}
        />
        {errors.email && (
          <p id="signup-email-error" className={authErrorTextClass} role="alert">
            {errors.email.message}
          </p>
        )}
      </div>

      {/* Password */}
      <div className="mt-4">
        <label htmlFor="signup-password" className={authLabelClass}>
          Password
        </label>
        <div className="relative">
          <input
            id="signup-password"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            placeholder="••••••••"
            className={cn(authInputClass, "pr-11", errors.password && invalidInputClass)}
            aria-invalid={!!errors.password}
            aria-describedby={errors.password ? "signup-password-error" : undefined}
            {...register("password")}
          />
          <button
            type="button"
            onClick={() => setShowPassword((p) => !p)}
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-surface-400 transition-colors hover:text-surface-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
            aria-label={showPassword ? "Hide password" : "Show password"}
            aria-pressed={showPassword}
          >
            {showPassword ? (
              <EyeOff className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Eye className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        </div>
        {errors.password ? (
          <p id="signup-password-error" className={authErrorTextClass} role="alert">
            {errors.password.message}
          </p>
        ) : (
          <p className="mt-1.5 text-xs text-surface-500">
            At least 8 characters with a number and an uppercase letter.
          </p>
        )}
      </div>

      {/* Confirm password */}
      <div className="mt-4">
        <label htmlFor="confirm_password" className={authLabelClass}>
          Confirm password
        </label>
        <input
          id="confirm_password"
          type={showPassword ? "text" : "password"}
          autoComplete="new-password"
          placeholder="••••••••"
          className={cn(authInputClass, errors.confirm_password && invalidInputClass)}
          aria-invalid={!!errors.confirm_password}
          aria-describedby={errors.confirm_password ? "confirm-password-error" : undefined}
          {...register("confirm_password")}
        />
        {errors.confirm_password && (
          <p id="confirm-password-error" className={authErrorTextClass} role="alert">
            {errors.confirm_password.message}
          </p>
        )}
      </div>

      {/* Hidden workspace ID resolved from the public signup-options endpoint */}
      <input type="hidden" {...register("organization_id")} />

      {serverError && (
        <div className="mt-5">
          <AuthNotice>{serverError}</AuthNotice>
        </div>
      )}
      {orgsError && !serverError && (
        <div className="mt-5">
          <AuthNotice>{orgsError}</AuthNotice>
        </div>
      )}

      <button
        type="submit"
        disabled={isSubmitting || orgsLoading || !defaultOrgId}
        className={cn(authPrimaryButtonClass, "mt-6")}
      >
        {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
        {isSubmitting ? "Creating account…" : "Create account"}
      </button>

      <SocialButtons
        onNotify={(message) => {
          setServerError(message);
          flashMood("sad", 1400);
        }}
      />

      {/* Switch back to sign-in */}
      <p className="mt-8 text-center text-sm text-surface-400">
        Already have an account?{" "}
        <button
          type="button"
          onClick={() => {
            setServerError(null);
            onSwitchToSignIn();
          }}
          className="font-semibold text-surface-100 underline-offset-4 transition-colors hover:text-brand-400 focus:outline-none focus-visible:underline"
        >
          Sign in
        </button>
      </p>
    </form>
  );
}
