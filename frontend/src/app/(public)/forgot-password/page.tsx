"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { motion } from "framer-motion";
import Link from "next/link";
import { ArrowLeft, Mail, Loader2, CheckCircle } from "lucide-react";
import { forgotPasswordSchema, type ForgotPasswordFormData } from "@/lib/validation/schemas";
import { authApi } from "@/lib/api/auth";
import { cn } from "@/lib/utils/cn";

const DEFAULT_ORG_ID = "00000000-0000-0000-0000-000000000001";

export default function ForgotPasswordPage() {
  const [submitted, setSubmitted] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordFormData>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { organization_id: DEFAULT_ORG_ID },
  });

  const onSubmit = async (data: ForgotPasswordFormData) => {
    // Always show success — prevents email enumeration
    await authApi.initiatePasswordReset(data.email, data.organization_id).catch(() => {});
    setSubmitted(true);
  };

  return (
    <div className="min-h-screen bg-surface-950 flex items-center justify-center px-4">
      <div className="absolute inset-0 auth-canvas" />
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative z-10 w-full max-w-md"
      >
        <div className="rounded-2xl glass-panel p-8">
          <Link
            href="/login"
            className="inline-flex items-center gap-2 text-sm text-surface-400 hover:text-surface-200 mb-6 focus:outline-none focus:underline"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to sign in
          </Link>

          {submitted ? (
            <div className="text-center py-4">
              <CheckCircle className="w-12 h-12 text-green-400 mx-auto mb-4" />
              <h1 className="text-xl font-semibold text-surface-100 mb-2">Check your email</h1>
              <p className="text-surface-400 text-sm">
                If an account exists for that email, we&apos;ve sent a password reset link.
              </p>
            </div>
          ) : (
            <>
              <h1 className="text-2xl font-semibold text-surface-100 mb-1">Reset password</h1>
              <p className="text-surface-400 text-sm mb-6">
                Enter your email and we&apos;ll send you a reset link.
              </p>

              <form onSubmit={handleSubmit(onSubmit)} noValidate>
                <div className="mb-4">
                  <label htmlFor="email" className="block text-sm font-medium text-surface-200 mb-1.5">
                    Email address
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-400" />
                    <input
                      id="email"
                      type="email"
                      autoComplete="email"
                      className={cn(
                        "w-full pl-10 pr-4 py-2.5 rounded-lg bg-surface-800/60 border text-surface-100",
                        "placeholder:text-surface-500 focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm transition-colors",
                        errors.email ? "border-red-500/60" : "border-surface-600/60"
                      )}
                      placeholder="you@company.com"
                      {...register("email")}
                    />
                  </div>
                  {errors.email && (
                    <p className="mt-1 text-xs text-red-400" role="alert">{errors.email.message}</p>
                  )}
                </div>

                <input type="hidden" {...register("organization_id")} />

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-2.5 rounded-lg bg-brand-600 hover:bg-brand-500 text-white font-medium text-sm disabled:opacity-60 flex items-center justify-center gap-2 focus:outline-none focus:ring-2 focus:ring-brand-400"
                >
                  {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
                  Send reset link
                </button>
              </form>
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}
