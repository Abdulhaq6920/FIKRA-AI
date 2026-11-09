"use client";

/**
 * Forgot-password — themed split-screen shell shared with the other auth pages.
 *
 * The workspace ID comes from the public /auth/signup-options endpoint
 * (never hard-coded). The flow stays deliberately silent on whether the
 * email exists: the endpoint always succeeds, so an attacker cannot use
 * this form to enumerate accounts.
 */

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { motion } from "framer-motion";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, Loader2, Mail } from "lucide-react";
import {
  forgotPasswordSchema,
  type ForgotPasswordFormData,
} from "@/lib/validation/schemas";
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
  useRobotStage,
  useSignupOptions,
} from "@/features/auth/AuthShell";
import { cn } from "@/lib/utils/cn";

export default function ForgotPasswordPage() {
  return (
    <AuthShell>
      <ForgotPasswordContent />
    </AuthShell>
  );
}

function ForgotPasswordContent() {
  const [submitted, setSubmitted] = useState(false);
  const { defaultOrgId, isLoading: orgsLoading, error: orgsError } = useSignupOptions();
  const { flashMood } = useRobotStage();

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordFormData>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { organization_id: undefined as unknown as string },
  });

  // Fill the workspace ID once the public org list resolves.
  useEffect(() => {
    if (defaultOrgId) setValue("organization_id", defaultOrgId);
  }, [defaultOrgId, setValue]);

  const onSubmit = async (data: ForgotPasswordFormData) => {
    // Always show success — prevents email enumeration.
    await authApi.initiatePasswordReset(data.email, data.organization_id).catch(() => {});
    flashMood("happy"); // good-news bounce with the email confirmation
    setSubmitted(true);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
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

        {submitted ? (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="mt-6"
          >
            <h1 className="text-3xl font-bold tracking-tight text-surface-100">
              Check your email
            </h1>
            <p className="mt-3 flex items-start gap-2.5 text-sm text-surface-400">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-brand-400" aria-hidden="true" />
              If an account exists for that email, we&apos;ve sent a password reset
              link. It expires shortly, so try again soon if you missed it.
            </p>
            <Link
              href="/login"
              className={cn(authPrimaryButtonClass, "mt-8")}
            >
              Return to sign in
            </Link>
          </motion.div>
        ) : (
          <>
            <h1 className="mt-5 text-3xl font-bold tracking-tight text-surface-100">
              Forgot password?
            </h1>
            <p className="mt-2 text-sm text-surface-400">
              Enter your email and we&apos;ll send you a reset link.
            </p>

            <form
              onSubmit={handleSubmit(onSubmit, () => flashMood("sad", 1400))}
              noValidate
              className="mt-8"
            >
              <div>
                <label htmlFor="email" className={authLabelClass}>
                  Email address
                </label>
                <div className="relative">
                  <Mail
                    className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-surface-500"
                    aria-hidden="true"
                  />
                  <input
                    id="email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@company.com"
                    className={cn(authInputClass, "pl-10", errors.email && invalidInputClass)}
                    aria-invalid={!!errors.email}
                    aria-describedby={errors.email ? "email-error" : undefined}
                    {...register("email")}
                  />
                </div>
                {errors.email && (
                  <p id="email-error" className={authErrorTextClass} role="alert">
                    {errors.email.message}
                  </p>
                )}
              </div>

              {/* Hidden workspace ID resolved from the public signup-options endpoint */}
              <input type="hidden" {...register("organization_id")} />

              {orgsError && (
                <div className="mt-5">
                  <AuthNotice>{orgsError}</AuthNotice>
                </div>
              )}

              <button
                type="submit"
                disabled={isSubmitting || orgsLoading || !defaultOrgId}
                className={cn(authPrimaryButtonClass, "mt-6")}
              >
                {(isSubmitting || orgsLoading) && (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                )}
                {isSubmitting ? "Sending…" : "Send reset link"}
              </button>
            </form>
          </>
        )}
    </motion.div>
  );
}
