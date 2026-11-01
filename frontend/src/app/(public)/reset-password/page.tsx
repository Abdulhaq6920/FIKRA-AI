"use client";

import { Suspense, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { motion } from "framer-motion";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2, CheckCircle, ArrowLeft } from "lucide-react";
import { resetPasswordSchema, type ResetPasswordFormData } from "@/lib/validation/schemas";
import { authApi } from "@/lib/api/auth";
import { ApiRequestError } from "@/lib/api/client";
import { cn } from "@/lib/utils/cn";

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-surface-950" />}>
      <ResetPasswordContent />
    </Suspense>
  );
}

function ResetPasswordContent() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token") ?? "";

  const [showPassword, setShowPassword] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const { register, handleSubmit, formState: { errors, isSubmitting } } =
    useForm<ResetPasswordFormData>({ resolver: zodResolver(resetPasswordSchema) });

  const onSubmit = async (data: ResetPasswordFormData) => {
    setServerError(null);
    if (!token) { setServerError("Invalid or missing reset token."); return; }
    try {
      await authApi.completePasswordReset(token, data.new_password);
      setDone(true);
      setTimeout(() => router.push("/login"), 3000);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setServerError("This reset link is invalid or has expired. Please request a new one.");
      } else {
        setServerError("Something went wrong. Please try again.");
      }
    }
  };

  return (
    <div className="min-h-screen bg-surface-950 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-gradient-to-br from-surface-950 via-[#0a0f1e] to-brand-950" />
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative z-10 w-full max-w-md"
      >
        <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-md p-8 shadow-2xl">
          <Link href="/login" className="inline-flex items-center gap-2 text-sm text-surface-400 hover:text-surface-200 mb-6">
            <ArrowLeft className="w-4 h-4" /> Back to sign in
          </Link>

          {done ? (
            <div className="text-center py-4">
              <CheckCircle className="w-12 h-12 text-green-400 mx-auto mb-4" />
              <h1 className="text-xl font-semibold text-white mb-2">Password updated</h1>
              <p className="text-surface-400 text-sm">Redirecting you to sign in…</p>
            </div>
          ) : (
            <>
              <h1 className="text-2xl font-semibold text-white mb-1">Set new password</h1>
              <p className="text-surface-400 text-sm mb-6">Choose a strong password for your account.</p>

              <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
                <div>
                  <label htmlFor="new_password" className="block text-sm font-medium text-surface-200 mb-1.5">New password</label>
                  <div className="relative">
                    <input
                      id="new_password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="new-password"
                      className={cn(
                        "w-full px-4 pr-10 py-2.5 rounded-lg bg-surface-800/60 border text-white placeholder:text-surface-500 focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm transition-colors",
                        errors.new_password ? "border-red-500/60" : "border-surface-600/60"
                      )}
                      placeholder="••••••••"
                      {...register("new_password")}
                    />
                    <button type="button" onClick={() => setShowPassword(p => !p)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-400 hover:text-surface-200"
                      aria-label={showPassword ? "Hide" : "Show"}>
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  {errors.new_password && <p className="mt-1 text-xs text-red-400">{errors.new_password.message}</p>}
                </div>

                <div>
                  <label htmlFor="confirm_password" className="block text-sm font-medium text-surface-200 mb-1.5">Confirm password</label>
                  <input
                    id="confirm_password"
                    type="password"
                    autoComplete="new-password"
                    className={cn(
                      "w-full px-4 py-2.5 rounded-lg bg-surface-800/60 border text-white placeholder:text-surface-500 focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm transition-colors",
                      errors.confirm_password ? "border-red-500/60" : "border-surface-600/60"
                    )}
                    placeholder="••••••••"
                    {...register("confirm_password")}
                  />
                  {errors.confirm_password && <p className="mt-1 text-xs text-red-400">{errors.confirm_password.message}</p>}
                </div>

                {serverError && (
                  <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30" role="alert">
                    <p className="text-sm text-red-400">{serverError}</p>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-2.5 rounded-lg bg-brand-600 hover:bg-brand-500 text-white font-medium text-sm disabled:opacity-60 flex items-center justify-center gap-2 focus:outline-none focus:ring-2 focus:ring-brand-400"
                >
                  {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
                  Update password
                </button>
              </form>
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}
