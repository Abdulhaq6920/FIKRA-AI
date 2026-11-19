"use client";

/**
 * Root error boundary.
 *
 * Before this existed, any render-time exception (for example a malformed
 * timestamp passed to `formatDateTime`) unmounted the tree and left a white
 * screen with no way back. `error.tsx` catches those errors inside the root
 * layout — the theme, currency and toast providers stay mounted — and offers
 * the two recoveries that actually work: retry the render, or leave the page.
 */

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, Home, RotateCcw } from "lucide-react";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The browser console keeps the stack for support; the UI below never
    // shows it, because a stack trace is not a user-facing message.
    console.error("Unhandled UI error", error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-950 px-6 py-16">
      <div className="w-full max-w-md rounded-2xl border border-surface-800 bg-surface-900 p-6 text-center">
        <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-full border border-red-500/30 bg-red-500/10">
          <AlertTriangle className="h-5 w-5 text-red-400" aria-hidden="true" />
        </div>
        <h1 className="text-lg font-semibold text-surface-100">Something went wrong</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-surface-400">
          This page hit an unexpected error. Your data is safe — retrying usually
          recovers the view.
        </p>
        {error.digest && (
          <p className="mt-3 font-mono text-[11px] text-surface-500">
            Reference: {error.digest}
          </p>
        )}
        <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-400"
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            Try again
          </button>
          <Link
            href="/chat"
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-surface-700 px-4 py-2 text-sm font-medium text-surface-200 transition-colors hover:bg-surface-800 focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            <Home className="h-4 w-4" aria-hidden="true" />
            Back to chat
          </Link>
        </div>
      </div>
    </div>
  );
}
