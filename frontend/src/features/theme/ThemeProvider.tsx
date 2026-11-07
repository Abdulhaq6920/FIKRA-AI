"use client";

/**
 * Theme provider.
 *
 * The root layout runs a tiny blocking script before paint so the selected
 * palette is already on `<html>` when the first frame renders. React state
 * catches up on mount, which avoids both a flash and a hydration mismatch.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  DEFAULT_THEME,
  THEME_STORAGE_KEY,
  getTheme,
  isThemeId,
  type ThemeDefinition,
  type ThemeId,
} from "./themes";

interface ThemeContextValue {
  theme: ThemeId;
  definition: ThemeDefinition;
  setTheme: (theme: ThemeId) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeId>(DEFAULT_THEME);

  // The inline script in layout.tsx has already resolved the persisted value.
  useEffect(() => {
    const applied = document.documentElement.dataset.theme;
    if (isThemeId(applied)) {
      setThemeState(applied);
      return;
    }
    try {
      const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
      if (isThemeId(stored)) setThemeState(stored);
    } catch {
      // Private browsing can deny localStorage; the default theme still applies.
    }
  }, []);

  const setTheme = useCallback((next: ThemeId) => {
    setThemeState(next);
    const root = document.documentElement;
    root.dataset.theme = next;
    root.dataset.tone = getTheme(next).mode;
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Persistence is a convenience, not a requirement.
    }
  }, []);

  const value = useMemo(
    () => ({ theme, definition: getTheme(theme), setTheme }),
    [theme, setTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used inside ThemeProvider");
  return context;
}
