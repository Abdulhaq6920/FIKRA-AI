"use client";

/**
 * Legacy /register route.
 *
 * Sign-up now lives on the shared /login split-screen (the forms slide
 * between panels there), so this route only forwards — deep links and old
 * bookmarks keep working without a flash of a second auth page.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

/** Keeps review quick: the exact destination, asserted once. */
const SIGNUP_URL = "/login?mode=signup";

export default function RegisterPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace(SIGNUP_URL);
  }, [router]);

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-screen flex-col items-center justify-center gap-3 bg-surface-950 text-surface-400"
    >
      <Loader2 className="h-6 w-6 animate-spin text-brand-500" aria-hidden="true" />
      <p className="text-sm">Taking you to sign up…</p>
    </div>
  );
}
