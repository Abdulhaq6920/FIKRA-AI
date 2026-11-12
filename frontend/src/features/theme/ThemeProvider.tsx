"use client";

/**
 * Theme provider.
 *
 * The root layout runs a tiny blocking script before paint so the selected
 * palette is already on `<html>` when the first frame renders. React state
 * catches up on mount, which avoids both a flash and a hydration mismatch.
 *
 * Switching burns a brief full-screen veil: the palette changes underneath a
 * soft fade, so even a drastic light → dark swap reads as an intentional
 * transition instead of a hard repaint.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
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
  const themeRef = useRef<ThemeId>(DEFAULT_THEME);
  const [veil, setVeil] = useState(0);
  const [veilOn, setVeilOn] = useState(false);
  const veilTimer = useRef<number | undefined>(undefined);

  // The inline script in layout.tsx has already resolved the persisted value.
  useEffect(() => {
    const applied = document.documentElement.dataset.theme;
    if (isThemeId(applied)) {
      themeRef.current = applied;
      setThemeState(applied);
      return;
    }
    try {
      const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
      if (isThemeId(stored)) {
        themeRef.current = stored;
        setThemeState(stored);
      }
    } catch {
      // Private browsing can deny localStorage; the default theme still applies.
    }
  }, []);

  useEffect(() => () => window.clearTimeout(veilTimer.current), []);

  const setTheme = useCallback((next: ThemeId) => {
    if (themeRef.current === next) return;
    themeRef.current = next;
    setThemeState(next);

    const root = document.documentElement;
    root.dataset.theme = next;
    root.dataset.tone = getTheme(next).mode;
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Persistence is a convenience, not a requirement.
    }

    // Retrigger the veil animation for every switch, even rapid ones.
    setVeil((value) => value + 1);
    setVeilOn(true);
    window.clearTimeout(veilTimer.current);
    veilTimer.current = window.setTimeout(() => setVeilOn(false), 700);
  }, []);

  const value = useMemo(
    () => ({ theme, definition: getTheme(theme), setTheme }),
    [theme, setTheme]
  );

  return (
    <ThemeContext.Provider value={value}>
      {children}
      {veilOn && <div key={veil} aria-hidden="true" className="theme-veil" />}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used inside ThemeProvider");
  return context;
}
