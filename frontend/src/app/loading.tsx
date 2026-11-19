import { Loader2 } from "lucide-react";

/**
 * Route-level loading fallback.
 *
 * Shown while a route segment's code/streamed content is still resolving. It
 * is deliberately a quiet, centred indicator rather than a skeleton: the
 * per-page skeletons already exist where the shape is known, and a generic
 * skeleton would promise a layout it cannot guarantee.
 */
export default function Loading() {
  return (
    <div
      className="flex min-h-screen items-center justify-center bg-surface-950"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-2 text-sm text-surface-400">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        Loading…
      </div>
    </div>
  );
}
