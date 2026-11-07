"use client";

/**
 * Global display-currency preference.
 *
 * All financial figures from the backend are USD estimates. The user picks a
 * display currency once (USD or INR) and every cost in the app — tiles, charts,
 * tables, question drill-downs — is rendered through `useCurrency().format`.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export type Currency = "USD" | "INR";

const STORAGE_KEY = "fikra-currency";
const USD_TO_INR = Number(process.env.NEXT_PUBLIC_USD_TO_INR_RATE ?? "83.5") || 83.5;

interface CurrencyContextValue {
  currency: Currency;
  setCurrency: (currency: Currency) => void;
  /** Convert a USD amount into the active display currency. */
  convert: (usd: number) => number;
  /** Format a USD amount using the active display currency. */
  format: (usd: number | null | undefined) => string;
  rate: number;
}

const CurrencyContext = createContext<CurrencyContextValue | null>(null);

export function formatMoney(usd: number | null | undefined, currency: Currency): string {
  if (usd === null || usd === undefined || Number.isNaN(usd)) return "—";
  const value = currency === "INR" ? usd * USD_TO_INR : usd;
  // Provider costs are frequently fractions of a cent, so keep four decimals
  // for small amounts and two for ordinary values.
  const maximumFractionDigits = Math.abs(value) < 1 ? 4 : 2;
  return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits,
  }).format(value);
}

export function CurrencyProvider({ children }: { children: React.ReactNode }) {
  const [currency, setCurrencyState] = useState<Currency>("USD");

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === "USD" || stored === "INR") setCurrencyState(stored);
    } catch {
      // Storage can be unavailable in private browsing; USD remains the default.
    }
  }, []);

  const setCurrency = useCallback((next: Currency) => {
    setCurrencyState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Ignore persistence failures.
    }
  }, []);

  const value = useMemo<CurrencyContextValue>(
    () => ({
      currency,
      setCurrency,
      convert: (usd: number) => (currency === "INR" ? usd * USD_TO_INR : usd),
      format: (usd: number | null | undefined) => formatMoney(usd, currency),
      rate: USD_TO_INR,
    }),
    [currency, setCurrency],
  );

  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>;
}

export function useCurrency(): CurrencyContextValue {
  const context = useContext(CurrencyContext);
  if (!context) {
    throw new Error("useCurrency must be used inside a CurrencyProvider");
  }
  return context;
}
