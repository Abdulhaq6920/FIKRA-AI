"use client";

/**
 * Animated Login Page — FIKRA AI
 *
 * Design:
 * - Deep navy/charcoal background
 * - Animated floating orbs and grid using CSS transforms (no WebGL)
 * - Glass-morphism login card
 * - Framer Motion entrance animations
 * - Fully accessible: visible focus states, ARIA labels, keyboard nav
 * - Respects prefers-reduced-motion
 * - Static fallback when animation is disabled
 */

import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { motion, useReducedMotion } from "framer-motion";
import Link from "next/link";
import { Eye, EyeOff, Loader2, Sparkles, Lock, Mail, Building2 } from "lucide-react";
import { useAuth } from "@/features/auth/AuthContext";
import { loginSchema, type LoginFormData } from "@/lib/validation/schemas";
import { ApiRequestError } from "@/lib/api/client";
import { cn } from "@/lib/utils/cn";

// Default org ID — in production this would come from URL slug or subdomain
const DEFAULT_ORG_ID = "00000000-0000-0000-0000-000000000001";

export default function LoginPage() {
  const { login } = useAuth();
  const [showPassword, setShowPassword] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const prefersReduced = useReducedMotion();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      organization_id: DEFAULT_ORG_ID,
    },
  });

  const onSubmit = async (data: LoginFormData) => {
    setServerError(null);
    try {
      await login(data);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        // Generic message to prevent account enumeration
        setServerError("Invalid email or password. Please try again.");
      } else {
        setServerError("Something went wrong. Please try again.");
      }
    }
  };

  return (
    <div className="relative min-h-screen bg-surface-950 flex items-center justify-center overflow-hidden">
      {/* ── Animated background ─────────────────────────────────────────── */}
      {!prefersReduced && <AnimatedBackground />}

      {/* ── Static background (reduced-motion or fallback) ──────────────── */}
      {prefersReduced && (
        <div className="absolute inset-0 auth-canvas" />
      )}

      {/* ── Login card ──────────────────────────────────────────────────── */}
      <motion.div
        initial={prefersReduced ? false : { opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="relative z-10 w-full max-w-md px-4"
      >
        <div className="rounded-2xl glass-panel p-8">
          {/* Logo & heading */}
          <div className="text-center mb-8">
            <motion.div
              initial={prefersReduced ? false : { scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.1, duration: 0.4 }}
              className="inline-flex items-center justify-center w-14 h-14 rounded-xl bg-brand-600/20 border border-brand-500/30 mb-4"
            >
              <Sparkles className="w-7 h-7 text-brand-400" aria-hidden="true" />
            </motion.div>
            <h1 className="text-2xl font-semibold text-surface-100">
              FIKRA AI
            </h1>
            <p className="text-sm text-surface-300 mt-1">
              Sign in to your workspace
            </p>
          </div>

          {/* Form */}
          <form
            onSubmit={handleSubmit(onSubmit)}
            noValidate
            aria-label="Sign in form"
          >
            {/* Email */}
            <div className="mb-4">
              <label
                htmlFor="email"
                className="block text-sm font-medium text-surface-200 mb-1.5"
              >
                Email address
              </label>
              <div className="relative">
                <Mail
                  className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-400"
                  aria-hidden="true"
                />
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  className={cn(
                    "w-full pl-10 pr-4 py-2.5 rounded-lg bg-surface-800/60 border text-surface-100",
                    "placeholder:text-surface-500 focus:outline-none focus:ring-2",
                    "focus:ring-brand-500 transition-colors text-sm",
                    errors.email
                      ? "border-red-500/60"
                      : "border-surface-600/60 hover:border-surface-500/80"
                  )}
                  placeholder="you@company.com"
                  aria-invalid={!!errors.email}
                  aria-describedby={errors.email ? "email-error" : undefined}
                  {...register("email")}
                />
              </div>
              {errors.email && (
                <p id="email-error" className="mt-1 text-xs text-red-400" role="alert">
                  {errors.email.message}
                </p>
              )}
            </div>

            {/* Password */}
            <div className="mb-4">
              <div className="flex items-center justify-between mb-1.5">
                <label
                  htmlFor="password"
                  className="block text-sm font-medium text-surface-200"
                >
                  Password
                </label>
                <Link
                  href="/forgot-password"
                  className="text-xs text-brand-400 hover:text-brand-300 focus:outline-none focus:underline"
                >
                  Forgot password?
                </Link>
              </div>
              <div className="relative">
                <Lock
                  className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-400"
                  aria-hidden="true"
                />
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  className={cn(
                    "w-full pl-10 pr-10 py-2.5 rounded-lg bg-surface-800/60 border text-surface-100",
                    "placeholder:text-surface-500 focus:outline-none focus:ring-2",
                    "focus:ring-brand-500 transition-colors text-sm",
                    errors.password
                      ? "border-red-500/60"
                      : "border-surface-600/60 hover:border-surface-500/80"
                  )}
                  placeholder="••••••••"
                  aria-invalid={!!errors.password}
                  aria-describedby={errors.password ? "password-error" : undefined}
                  {...register("password")}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((p) => !p)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-400 hover:text-surface-200 focus:outline-none focus:ring-2 focus:ring-brand-500 rounded"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
              {errors.password && (
                <p id="password-error" className="mt-1 text-xs text-red-400" role="alert">
                  {errors.password.message}
                </p>
              )}
            </div>

            {/* Hidden organization_id */}
            <input type="hidden" {...register("organization_id")} />

            {/* Server error */}
            {serverError && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30"
                role="alert"
                aria-live="polite"
              >
                <p className="text-sm text-red-400">{serverError}</p>
              </motion.div>
            )}

            {/* Submit button */}
            <button
              type="submit"
              disabled={isSubmitting}
              className={cn(
                "w-full py-2.5 px-4 rounded-lg font-medium text-sm transition-all",
                "bg-brand-600 hover:bg-brand-500 text-white",
                "focus:outline-none focus:ring-2 focus:ring-brand-400 focus:ring-offset-2 focus:ring-offset-surface-900",
                "disabled:opacity-60 disabled:cursor-not-allowed",
                "flex items-center justify-center gap-2"
              )}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                  <span>Signing in…</span>
                </>
              ) : (
                "Sign in"
              )}
            </button>
          </form>

          {/* Register link */}
          <p className="mt-6 text-center text-sm text-surface-400">
            Don&apos;t have an account?{" "}
            <Link
              href="/register"
              className="text-brand-400 hover:text-brand-300 font-medium focus:outline-none focus:underline"
            >
              Create account
            </Link>
          </p>
        </div>
      </motion.div>
    </div>
  );
}

// ─── Animated Background ──────────────────────────────────────────────────

function AnimatedBackground() {
  return (
    <>
      {/* Base gradient */}
      <div className="absolute inset-0 auth-canvas" />

      {/* Grid overlay */}
      <div
        className="absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage: `
            linear-gradient(rgba(99,102,241,0.5) 1px, transparent 1px),
            linear-gradient(90deg, rgba(99,102,241,0.5) 1px, transparent 1px)
          `,
          backgroundSize: "48px 48px",
        }}
      />

      {/* Floating orbs — CSS animation only, no WebGL */}
      <Orb
        className="w-96 h-96 -top-32 -left-32 bg-brand-700/20 blur-3xl"
        duration={12}
      />
      <Orb
        className="w-80 h-80 -bottom-24 -right-24 bg-accent-violet/10 blur-3xl"
        duration={18}
        delay={3}
      />
      <Orb
        className="w-64 h-64 top-1/3 right-1/4 bg-accent-cyan/8 blur-2xl"
        duration={15}
        delay={6}
      />

      {/* Subtle radial glow at centre */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="w-[600px] h-[600px] rounded-full bg-brand-600/5 blur-3xl" />
      </div>
    </>
  );
}

function Orb({
  className,
  duration,
  delay = 0,
}: {
  className: string;
  duration: number;
  delay?: number;
}) {
  return (
    <motion.div
      className={cn("absolute rounded-full", className)}
      animate={{
        x: [0, 30, -20, 10, 0],
        y: [0, -20, 30, -10, 0],
      }}
      transition={{
        duration,
        delay,
        repeat: Infinity,
        ease: "easeInOut",
      }}
    />
  );
}
