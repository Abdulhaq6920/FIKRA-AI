"use client";

/**
 * Reset-password — themed split-screen shell shared with the other auth pages.
 *
 * Reads the one-time `?token=` from the reset email and swaps the account
 * password. The Suspense boundary is required: useSearchParams() needs one
 * during static prerender, and the token must survive a fresh navigation
 * from the email link.
 */

import { Suspense, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { motion } from "framer-motion";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle2, Eye, EyeOff, Loader2 } from "lucide-react";
import {
  resetPasswordSchema,
  type ResetPasswordFormData,
} from "@/lib/validation/schemas";
import { authApi } from "@/lib/api/auth";
import { ApiRequestError } from "@/lib/api/client";
import {
  AuthNotice,
  AuthShell,
  authErrorTextClass,
  authInputClass,
  authLabelClass,
  authPrimaryButtonClass,
  invalidInputClass,
  LogoMark,
  useRobotStage,
} from "@/features/auth/AuthShell";
import { cn } from "@/lib/utils/cn";

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordContent />
    </Suspense>
  );
}

function ResetPasswordContent() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";

  return (
    <AuthShell>
      <ResetPasswordForm token={token} />
    </AuthShell>
  );
}

function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();

  const [showPassword, setShowPassword] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const { flashMood, holdMood } = useRobotStage();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordFormData>({ resolver: zodResolver(resetPasswordSchema) });

  const onSubmit = async (data: ResetPasswordFormData) => {
    setServerError(null);
    if (!token) {
      flashMood("sad", 2000);
      setServerError("This reset link is missing its token. Please request a new one.");
      return;
    }
    try {
      await authApi.completePasswordReset(token, data.new_password);
      // Wink and hold: the redirect to /login lands 3s after success, so the
      // mascot's celebration stays on screen right up to route change.
      holdMood("wink");
      setDone(true);
      // Give the success state a beat to be read, then land on sign-in.
      setTimeout(() => router.push("/login"), 3000);
    } catch (err) {
      flashMood("sad", 2200);
      if (err instanceof ApiRequestError) {
        setServerError("This reset link is invalid or has expired. Please request a new one.");
      } else {
        setServerError("Something went wrong. Please try again.");
      }
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
      className="w-full max-w-[400px]"
    >
        <Link
          href="/login"
          className="inline-flex items-center gap-2 text-sm font-medium text-surface-400 underline-offset-4 transition-colors hover:text-brand-400 focus:outline-none focus-visible:underline"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to sign in
        </Link>

        <div className="mt-8">
          <LogoMark />
        </div>

        {done ? (
          <motion.div
            initial={{ opacity: 0, filter: "blur(4px)" }}
            animate={{ opacity: 1, filter: "blur(0px)" }}
            transition={{ duration: 0.32, ease: "easeOut" }}
            className="mt-6"
          >
            <h1 className="text-3xl font-bold tracking-tight text-surface-100">
              Password updated
            </h1>
            <p className="mt-3 flex items-start gap-2.5 text-sm text-surface-400">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-brand-400" aria-hidden="true" />
              Your password has been changed. Redirecting you to sign in…
            </p>
            <Link href="/login" className={cn(authPrimaryButtonClass, "mt-8")}>
              Sign in now
            </Link>
          </motion.div>
        ) : (
          <>
            <h1 className="mt-5 text-3xl font-bold tracking-tight text-surface-100">
              Set new password
            </h1>
            <p className="mt-2 text-sm text-surface-400">
              Choose a strong password for your account.
            </p>

            <form
              onSubmit={handleSubmit(onSubmit, () => flashMood("sad", 1400))}
              noValidate
              className="mt-8"
            >
              {/* New password */}
              <div>
                <label htmlFor="new_password" className={authLabelClass}>
                  New password
                </label>
                <div className="relative">
                  <input
                    id="new_password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder="••••••••"
                    className={cn(
                      authInputClass,
                      "pr-11",
                      errors.new_password && invalidInputClass
                    )}
                    aria-invalid={!!errors.new_password}
                    aria-describedby={errors.new_password ? "new-password-error" : undefined}
                    {...register("new_password")}
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
                {errors.new_password ? (
                  <p id="new-password-error" className={authErrorTextClass} role="alert">
                    {errors.new_password.message}
                  </p>
                ) : (
                  <p className="mt-1.5 text-xs text-surface-500">
                    At least 8 characters with a number and an uppercase letter.
                  </p>
                )}
              </div>

              {/* Confirm */}
              <div className="mt-4">
                <label htmlFor="confirm_password" className={authLabelClass}>
                  Confirm password
                </label>
                <input
                  id="confirm_password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  placeholder="••••••••"
                  className={cn(
                    authInputClass,
                    errors.confirm_password && invalidInputClass
                  )}
                  aria-invalid={!!errors.confirm_password}
                  aria-describedby={
                    errors.confirm_password ? "confirm-password-error" : undefined
                  }
                  {...register("confirm_password")}
                />
                {errors.confirm_password && (
                  <p id="confirm-password-error" className={authErrorTextClass} role="alert">
                    {errors.confirm_password.message}
                  </p>
                )}
              </div>

              {serverError && (
                <div className="mt-5">
                  <AuthNotice>{serverError}</AuthNotice>
                </div>
              )}

              <button
                type="submit"
                disabled={isSubmitting}
                className={cn(authPrimaryButtonClass, "mt-6")}
              >
                {isSubmitting && (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                )}
                {isSubmitting ? "Updating…" : "Update password"}
              </button>
            </form>
          </>
        )}
    </motion.div>
  );
}
