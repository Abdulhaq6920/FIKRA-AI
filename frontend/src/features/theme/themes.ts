/**
 * Theme catalogue for FIKRA AI.
 *
 * Colours themselves live in `globals.css` as `[data-theme]` CSS-variable
 * blocks so switching themes never triggers a React render of the whole app.
 * This module only holds the metadata the picker and shell need.
 */

export type ThemeMode = "light" | "dark";
export type ThemeCollection = "professional" | "anime" | "fantasy";

/** Original hand-built illustration variants shipped with anime themes. */
export type ThemeArtwork = "leaf" | "sharingan" | "jinwoo" | "igris";

export interface ThemeDefinition {
  id: ThemeId;
  name: string;
  description: string;
  mode: ThemeMode;
  collection: ThemeCollection;
  /** Three representative colours used by the picker preview. */
  swatches: readonly [string, string, string];
  /** Anime themes render an original character illustration. */
  artwork?: ThemeArtwork;
  /**
   * Themes with a richer ambient backdrop (drifting nebulae, twinkling
   * stars, rising embers…) rendered purely in CSS.
   */
  animated?: boolean;
}

export type ThemeId =
  | "royal-glass"
  | "aurora"
  | "parchment"
  | "ocean"
  | "emerald"
  | "sunset"
  | "midnight"
  | "graphite"
  | "naruto-leaf"
  | "naruto-sharingan"
  | "solo-jinwoo"
  | "solo-igris"
  | "enchanted-dawn"
  | "blossom-breeze"
  | "arcane-midnight"
  | "ember-abyss"
  | "frozen-citadel"
  | "void-nebula"
  | "emerald-enigma";

export const THEMES: readonly ThemeDefinition[] = [
  // ─── Professional — eight focused, production-grade palettes ─────────────
  {
    id: "royal-glass",
    name: "Royal Glass",
    description: "Charcoal and navy glass lit by amber, bronze and royal indigo.",
    mode: "dark",
    collection: "professional",
    swatches: ["#0d0d10", "#121118", "#d4af37"],
    animated: true,
  },
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

  // ─── Anime — two ninja worlds + two Solo Leveling worlds ─────────────────
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
  {
    id: "solo-jinwoo",
    name: "Sung Jinwoo",
    description: "Shadow-monarch navy lit by violet mana and rising shadow motes.",
    mode: "dark",
    collection: "anime",
    swatches: ["#05060f", "#0b1024", "#818cf8"],
    artwork: "jinwoo",
    animated: true,
  },
  {
    id: "solo-igris",
    name: "Igris",
    description: "Crimson knight plate, ember sparks, and a blood-red command glow.",
    mode: "dark",
    collection: "anime",
    swatches: ["#080505", "#170b0b", "#ef4444"],
    artwork: "igris",
    animated: true,
  },

  // ─── Fantasy — seven animated storybook worlds ───────────────────────────
  {
    id: "enchanted-dawn",
    name: "Enchanted Dawn",
    description: "A golden sunrise over a storybook kingdom, drifting light.",
    mode: "light",
    collection: "fantasy",
    swatches: ["#fdf6ec", "#fffdf9", "#d97706"],
    animated: true,
  },
  {
    id: "blossom-breeze",
    name: "Blossom Breeze",
    description: "A sakura courtyard with petals falling forever.",
    mode: "light",
    collection: "fantasy",
    swatches: ["#fff5f9", "#fffbfd", "#db2777"],
    animated: true,
  },
  {
    id: "arcane-midnight",
    name: "Arcane Midnight",
    description: "A wizard's tower bathed in drifting violet spellfire.",
    mode: "dark",
    collection: "fantasy",
    swatches: ["#0b0916", "#120f21", "#a78bfa"],
    animated: true,
  },
  {
    id: "ember-abyss",
    name: "Ember Abyss",
    description: "Deep forge-dark where sparks rise from the depths.",
    mode: "dark",
    collection: "fantasy",
    swatches: ["#0c0908", "#16100d", "#fb923c"],
    animated: true,
  },
  {
    id: "frozen-citadel",
    name: "Frozen Citadel",
    description: "A glacial keep under silent, endless snowfall.",
    mode: "dark",
    collection: "fantasy",
    swatches: ["#08111a", "#0d1a26", "#67e8f9"],
    animated: true,
  },
  {
    id: "void-nebula",
    name: "Void Nebula",
    description: "Deep space with a breathing violet nebula and far stars.",
    mode: "dark",
    collection: "fantasy",
    swatches: ["#09060f", "#150c1f", "#e879f9"],
    animated: true,
  },
  {
    id: "emerald-enigma",
    name: "Emerald Enigma",
    description: "An ancient forest where jade wisps wander the dark.",
    mode: "dark",
    collection: "fantasy",
    swatches: ["#08120f", "#0e1f19", "#34d399"],
    animated: true,
  },
];

export const DEFAULT_THEME: ThemeId = "royal-glass";
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
export const FANTASY_THEMES = THEMES.filter((theme) => theme.collection === "fantasy");
