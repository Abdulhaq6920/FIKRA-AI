"use client";

/**
 * Browser-style back/forward controls for an SPA.
 *
 * Next.js App Router navigations do not expose a history index, so this hook
 * annotates every history entry with a monotonically increasing index. That
 * lets the UI disable Back at the first in-app entry and enable Forward only
 * after the user has actually stepped backwards.
 */

import { useCallback, useEffect, useState } from "react";

const INDEX_KEY = "__fikraHistoryIndex";
const MAX_KEY = "__fikraHistoryMaxIndex";

interface HistoryNavigation {
  canGoBack: boolean;
  canGoForward: boolean;
  goBack: () => void;
  goForward: () => void;
}

function readIndex(state: unknown): number | null {
  if (state && typeof state === "object") {
    const value = (state as Record<string, unknown>)[INDEX_KEY];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function readMaxIndex(): number {
  try {
    const raw = window.sessionStorage.getItem(MAX_KEY);
    if (raw === null) return 0;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    return 0;
  }
}

function writeMaxIndex(value: number): void {
  try {
    window.sessionStorage.setItem(MAX_KEY, String(value));
  } catch {
    // Storage can be unavailable (private mode); in-memory state still works.
  }
}

export function useHistoryNavigation(): HistoryNavigation {
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);

  useEffect(() => {
    // Seed the current entry. `history.length - 1` gives a sensible Back
    // state for entries created before the app mounted (for example login).
    if (readIndex(window.history.state) === null) {
      const seed = Math.max(0, window.history.length - 1);
      window.history.replaceState(
        { ...(window.history.state ?? {}), [INDEX_KEY]: seed },
        ""
      );
      writeMaxIndex(Math.max(readMaxIndex(), seed));
    }

    const sync = () => {
      const index = readIndex(window.history.state) ?? 0;
      const max = Math.max(readMaxIndex(), index);
      writeMaxIndex(max);
      setCanGoBack(index > 0);
      setCanGoForward(index < max);
    };

    const pushState = window.history.pushState;
    const replaceState = window.history.replaceState;

    const annotatedPush: History["pushState"] = function (data, unused, url) {
      const current = readIndex(window.history.state) ?? 0;
      const next = current + 1;
      const state =
        data && typeof data === "object"
          ? { ...(data as Record<string, unknown>), [INDEX_KEY]: next }
          : { [INDEX_KEY]: next };
      // Pushing truncates any forward entries.
      writeMaxIndex(next);
      const result = pushState.call(window.history, state, unused, url);
      // Next.js calls pushState inside useInsertionEffect, where React forbids
      // scheduling updates; defer the button-state sync to a microtask.
      queueMicrotask(sync);
      return result;
    };

    const annotatedReplace: History["replaceState"] = function (data, unused, url) {
      const current = readIndex(window.history.state) ?? 0;
      const state =
        data && typeof data === "object"
          ? { ...(data as Record<string, unknown>), [INDEX_KEY]: current }
          : { [INDEX_KEY]: current };
      const result = replaceState.call(window.history, state, unused, url);
      queueMicrotask(sync);
      return result;
    };

    window.history.pushState = annotatedPush;
    window.history.replaceState = annotatedReplace;
    window.addEventListener("popstate", sync);
    sync();

    return () => {
      window.history.pushState = pushState;
      window.history.replaceState = replaceState;
      window.removeEventListener("popstate", sync);
    };
  }, []);

  const goBack = useCallback(() => window.history.back(), []);
  const goForward = useCallback(() => window.history.forward(), []);

  return { canGoBack, canGoForward, goBack, goForward };
}
