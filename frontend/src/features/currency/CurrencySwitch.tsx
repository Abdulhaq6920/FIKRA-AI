"use client";

/**
 * Compact USD/INR toggle for the app header. The selection is shared by every
 * cost display through the CurrencyProvider context.
 */

import { cn } from "@/lib/utils/cn";
import { useCurrency, type Currency } from "./CurrencyProvider";

const OPTIONS: { value: Currency; label: string }[] = [
  { value: "USD", label: "USD $" },
  { value: "INR", label: "INR ₹" },
];

export function CurrencySwitch({ className }: { className?: string }) {
  const { currency, setCurrency } = useCurrency();

  return (
    <div
      className={cn(
        "inline-flex items-center rounded-lg border border-surface-800 bg-surface-900 p-0.5",
        className,
      )}
      role="group"
      aria-label="Display currency"
    >
      {OPTIONS.map((option) => {
        const active = currency === option.value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => setCurrency(option.value)}
            aria-pressed={active}
            title={`Show costs in ${option.value}`}
            className={cn(
              "rounded-md px-2 py-1 text-[11px] font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500",
              active
                ? "bg-brand-500/20 text-brand-200"
                : "text-surface-400 hover:bg-surface-800 hover:text-surface-200",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
