import Link from "next/link";
import { Compass, MessageSquare } from "lucide-react";

/**
 * 404 for unknown routes. Rendered inside the root layout, so the app's theme
 * tokens are available and the page matches the rest of the product instead of
 * Next's bare default.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-950 px-6 py-16">
      <div className="w-full max-w-md rounded-2xl border border-surface-800 bg-surface-900 p-6 text-center">
        <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-full border border-brand-500/30 bg-brand-500/10">
          <Compass className="h-5 w-5 text-brand-400" aria-hidden="true" />
        </div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-surface-500">
          Error 404
        </p>
        <h1 className="mt-1 text-lg font-semibold text-surface-100">Page not found</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-surface-400">
          The page you followed does not exist, or it was moved.
        </p>
        <Link
          href="/chat"
          className="mt-6 inline-flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-400"
        >
          <MessageSquare className="h-4 w-4" aria-hidden="true" />
          Back to chat
        </Link>
      </div>
    </div>
  );
}
