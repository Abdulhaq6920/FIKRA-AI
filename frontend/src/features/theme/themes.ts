/**
 * Theme catalogue for FIKRA AI.
 *
 * Colours themselves live in `globals.css` as `[data-theme]` CSS-variable
 * blocks so switching themes never triggers a React render of the whole app.
 * This module only holds the metadata the picker and shell need.
 */

export type ThemeMode = "light" | "dark";
export type ThemeCollection = "professional" | "anime";

export interface ThemeDefinition {
  id: ThemeId;
  name: string;
  description: string;
  mode: ThemeMode;
  collection: ThemeCollection;
  /** Three representative colours used by the picker preview. */
  swatches: readonly [string, string, string];
  /** Anime themes also render an original chibi-ninja illustration. */
  artwork?: "leaf" | "sharingan";
}

export type ThemeId =
  | "aurora"
  | "parchment"
  | "ocean"
  | "emerald"
  | "sunset"
  | "lavender"
  | "quartz"
  | "cobalt"
  | "midnight"
  | "graphite"
  | "naruto-leaf"
  | "naruto-sharingan";

export const THEMES: readonly ThemeDefinition[] = [
  {
    id: "aurora",
    name: "Aurora",
    description: "Airy indigo light with a calm, product-grade finish.",
    mode: "light",
    collection: "professional",
    swatches: ["#f7f9fc", "#ffffff", "#4f46e5"],
  },
  {
    id: "parchment",
    name: "Parchment",
    description: "Warm editorial cream, ink text, and burnt-orange accents.",
    mode: "light",
    collection: "professional",
    swatches: ["#faf6ee", "#fffcf6", "#c2410c"],
  },
  {
    id: "ocean",
    name: "Ocean",
    description: "Cool coastal blues with crisp white cards.",
    mode: "light",
    collection: "professional",
    swatches: ["#f6fafd", "#ffffff", "#0369a1"],
  },
  {
    id: "emerald",
    name: "Evergreen",
    description: "Fresh mint surfaces and a grounded forest accent.",
    mode: "light",
    collection: "professional",
    swatches: ["#f5fbf7", "#ffffff", "#047857"],
  },
  {
    id: "sunset",
    name: "Sunset Coral",
    description: "Peach-washed canvas with confident coral highlights.",
    mode: "light",
    collection: "professional",
    swatches: ["#fff8f5", "#fffdfc", "#e11d48"],
  },
  {
    id: "lavender",
    name: "Lavender",
    description: "Soft violet light with a refined, modern mood.",
    mode: "light",
    collection: "professional",
    swatches: ["#faf8ff", "#ffffff", "#7c3aed"],
  },
  {
    id: "quartz",
    name: "Quartz",
    description: "Neutral stone tones for distraction-free long sessions.",
    mode: "light",
    collection: "professional",
    swatches: ["#f8fafc", "#ffffff", "#475569"],
  },
  {
    id: "cobalt",
    name: "Cobalt Studio",
    description: "Crisp white workspace with a bold cobalt signature.",
    mode: "light",
    collection: "professional",
    swatches: ["#f7faff", "#ffffff", "#1d4ed8"],
  },
  {
    id: "midnight",
    name: "Midnight Ink",
    description: "Deep ink surfaces and luminous indigo highlights.",
    mode: "dark",
    collection: "professional",
    swatches: ["#070a12", "#0e131f", "#818cf8"],
  },
  {
    id: "graphite",
    name: "Graphite Pro",
    description: "Low-glare charcoal with precise steel-blue accents.",
    mode: "dark",
    collection: "professional",
    swatches: ["#090d14", "#111827", "#60a5fa"],
  },
  {
    id: "naruto-leaf",
    name: "Konoha Dawn",
    description: "Leaf-village sunrise: warm sand, chakra orange, and ninja spirit.",
    mode: "light",
    collection: "anime",
    swatches: ["#fdf8f0", "#fffdf8", "#ea580c"],
    artwork: "leaf",
  },
  {
    id: "naruto-sharingan",
    name: "Sharingan Nightfall",
    description: "Crimson dōjutsu glow over a midnight mission canvas.",
    mode: "dark",
    collection: "anime",
    swatches: ["#0b0505", "#140a0a", "#ef4444"],
    artwork: "sharingan",
  },
];

export const DEFAULT_THEME: ThemeId = "aurora";
export const THEME_STORAGE_KEY = "fikra-theme";

const THEME_IDS = new Set<string>(THEMES.map((theme) => theme.id));

export function isThemeId(value: string | null | undefined): value is ThemeId {
  return Boolean(value && THEME_IDS.has(value));
}

export function getTheme(id: ThemeId): ThemeDefinition {
  return THEMES.find((theme) => theme.id === id) ?? THEMES[0];
}

export const PROFESSIONAL_THEMES = THEMES.filter(
  (theme) => theme.collection === "professional"
);
export const ANIME_THEMES = THEMES.filter((theme) => theme.collection === "anime");
