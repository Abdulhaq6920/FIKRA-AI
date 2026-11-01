"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { motion } from "framer-motion";
import Link from "next/link";
import { Eye, EyeOff, Loader2, Sparkles } from "lucide-react";
import { registerSchema, type RegisterFormData } from "@/lib/validation/schemas";
import { authApi } from "@/lib/api/auth";
import { ApiRequestError } from "@/lib/api/client";
import { cn } from "@/lib/utils/cn";
import { useRouter } from "next/navigation";

const DEFAULT_ORG_ID = "00000000-0000-0000-0000-000000000001";

export default function RegisterPage() {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
    defaultValues: { organization_id: DEFAULT_ORG_ID },
  });

  const onSubmit = async (data: RegisterFormData) => {
    setServerError(null);
    try {
      await authApi.register({
        email: data.email,
        password: data.password,
        full_name: data.full_name,
        organization_id: data.organization_id,
      });
      router.push("/login?registered=1");
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setServerError(err.message);
      } else {
        setServerError("Registration failed. Please try again.");
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
          <div className="text-center mb-6">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-brand-600/20 border border-brand-500/30 mb-3">
              <Sparkles className="w-6 h-6 text-brand-400" />
            </div>
            <h1 className="text-2xl font-semibold text-white">Create account</h1>
            <p className="text-sm text-surface-400 mt-1">Join FIKRA AI</p>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
            <div>
              <label htmlFor="full_name" className="block text-sm font-medium text-surface-200 mb-1.5">Full name</label>
              <input
                id="full_name"
                type="text"
                autoComplete="name"
                className={cn("w-full px-4 py-2.5 rounded-lg bg-surface-800/60 border text-white placeholder:text-surface-500 focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm transition-colors", errors.full_name ? "border-red-500/60" : "border-surface-600/60")}
                placeholder="Jane Smith"
                {...register("full_name")}
              />
              {errors.full_name && <p className="mt-1 text-xs text-red-400">{errors.full_name.message}</p>}
            </div>

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-surface-200 mb-1.5">Email address</label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                className={cn("w-full px-4 py-2.5 rounded-lg bg-surface-800/60 border text-white placeholder:text-surface-500 focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm transition-colors", errors.email ? "border-red-500/60" : "border-surface-600/60")}
                placeholder="you@company.com"
                {...register("email")}
              />
              {errors.email && <p className="mt-1 text-xs text-red-400">{errors.email.message}</p>}
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-surface-200 mb-1.5">Password</label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  className={cn("w-full pr-10 px-4 py-2.5 rounded-lg bg-surface-800/60 border text-white placeholder:text-surface-500 focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm transition-colors", errors.password ? "border-red-500/60" : "border-surface-600/60")}
                  placeholder="••••••••"
                  {...register("password")}
                />
                <button type="button" onClick={() => setShowPassword(p => !p)} className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-400 hover:text-surface-200" aria-label={showPassword ? "Hide" : "Show"}>
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {errors.password && <p className="mt-1 text-xs text-red-400">{errors.password.message}</p>}
            </div>

            <div>
              <label htmlFor="confirm_password" className="block text-sm font-medium text-surface-200 mb-1.5">Confirm password</label>
              <input
                id="confirm_password"
                type="password"
                autoComplete="new-password"
                className={cn("w-full px-4 py-2.5 rounded-lg bg-surface-800/60 border text-white placeholder:text-surface-500 focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm transition-colors", errors.confirm_password ? "border-red-500/60" : "border-surface-600/60")}
                placeholder="••••••••"
                {...register("confirm_password")}
              />
              {errors.confirm_password && <p className="mt-1 text-xs text-red-400">{errors.confirm_password.message}</p>}
            </div>

            <input type="hidden" {...register("organization_id")} />

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
              Create account
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-surface-400">
            Already have an account?{" "}
            <Link href="/login" className="text-brand-400 hover:text-brand-300 font-medium focus:outline-none focus:underline">Sign in</Link>
          </p>
        </div>
      </motion.div>
    </div>
  );
}
