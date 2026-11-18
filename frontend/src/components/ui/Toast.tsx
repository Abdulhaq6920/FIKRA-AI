"use client";

/**
 * One toast surface for the whole app.
 *
 * Before this existed every mutation had its own ad-hoc failure handling:
 * some swallowed the error entirely (`catch {}`), some rendered an inline
 * banner, and the UI still looked successful. `useToast()` gives every caller
 * the same, visible outcome for a failed write.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export type ToastTone = "success" | "error" | "info";

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

interface ToastApi {
  /** Show a transient message. Errors stay a little longer than successes. */
  show: (message: string, tone?: ToastTone) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const TONE_STYLES: Record<ToastTone, string> = {
  success: "border-emerald-500/30 bg-emerald-500/10 text-emerald-100",
  error: "border-red-500/30 bg-red-500/10 text-red-100",
  info: "border-surface-700 bg-surface-900 text-surface-100",
};

const TONE_ICONS: Record<ToastTone, React.ReactNode> = {
  success: <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-300" />,
  error: <AlertTriangle className="h-4 w-4 shrink-0 text-red-300" />,
  info: <Info className="h-4 w-4 shrink-0 text-brand-300" />,
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(0);
  const timers = useRef<number[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((previous) => previous.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback(
    (message: string, tone: ToastTone = "info") => {
      const id = (nextId.current += 1);
      // Keep the stack short: an error loop must not cover the whole screen.
      setToasts((previous) => [...previous.slice(-2), { id, message, tone }]);
      const timer = window.setTimeout(
        () => dismiss(id),
        tone === "error" ? 7000 : 4000
      );
      timers.current.push(timer);
    },
    [dismiss]
  );

  useEffect(
    () => () => {
      timers.current.forEach((timer) => window.clearTimeout(timer));
    },
    []
  );

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div
        className="pointer-events-none fixed bottom-6 right-4 z-[90] flex w-full max-w-sm flex-col gap-2 sm:right-6"
        aria-live="polite"
        aria-atomic="false"
      >
        <AnimatePresence initial={false}>
          {toasts.map((toast) => (
            <motion.div
              key={toast.id}
              layout
              initial={{ opacity: 0, y: 8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 4, scale: 0.98 }}
              transition={{ duration: 0.16, ease: "easeOut" }}
              role={toast.tone === "error" ? "alert" : "status"}
              className={cn(
                "pointer-events-auto flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-xs shadow-xl backdrop-blur",
                TONE_STYLES[toast.tone]
              )}
            >
              {TONE_ICONS[toast.tone]}
              <p className="flex-1 leading-relaxed">{toast.message}</p>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                aria-label="Dismiss notification"
                className="rounded p-0.5 text-current opacity-60 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used inside <ToastProvider>");
  }
  return context;
}
