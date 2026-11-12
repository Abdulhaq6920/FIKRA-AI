/**
 * Theme catalogue for FIKRA AI.
 *
 * Colours themselves live in `globals.css` as `[data-theme]` CSS-variable
 * blocks so switching themes never triggers a React render of the whole app.
 * This module only holds the metadata the picker and shell need.
 *
 * Only animated palettes ship: the Royal Glass signature plus seven fantasy
 * worlds. Every entry renders live ambient motion, and Royal Glass is the
 * default for everyone (including users with an older stored preference).
 */

export type ThemeMode = "light" | "dark";
export type ThemeCollection = "signature" | "fantasy";

export interface ThemeDefinition {
  id: ThemeId;
  name: string;
  description: string;
  mode: ThemeMode;
  collection: ThemeCollection;
  /** Three representative colours used by the picker preview. */
  swatches: readonly [string, string, string];
  /**
   * Themes with a richer ambient backdrop (drifting nebulae, twinkling
   * stars, rising embers…) rendered purely in CSS.
   */
  animated: true;
}

export type ThemeId =
  | "royal-glass"
  | "enchanted-dawn"
  | "blossom-breeze"
  | "arcane-midnight"
  | "ember-abyss"
  | "frozen-citadel"
  | "void-nebula"
  | "emerald-enigma";

export const THEMES: readonly ThemeDefinition[] = [
  // ─── Signature — the default Royal Glass world ───────────────────────────
  {
    id: "royal-glass",
    name: "Royal Glass",
    description: "Charcoal and navy glass lit by amber, bronze and royal indigo.",
    mode: "dark",
    collection: "signature",
    swatches: ["#0d0d10", "#121118", "#d4af37"],
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
/**
 * Bumped from `fikra-theme` so removed/retired palettes (including the anime
 * worlds) cannot persist. Everyone re-enters on Royal Glass exactly once;
 * choices made from here on are remembered as usual.
 */
export const THEME_STORAGE_KEY = "fikra-theme-v2";

const THEME_IDS = new Set<string>(THEMES.map((theme) => theme.id));

export function isThemeId(value: string | null | undefined): value is ThemeId {
  return Boolean(value && THEME_IDS.has(value));
}

export function getTheme(id: ThemeId): ThemeDefinition {
  return THEMES.find((theme) => theme.id === id) ?? THEMES[0];
}

export const SIGNATURE_THEMES = THEMES.filter(
  (theme) => theme.collection === "signature"
);
export const FANTASY_THEMES = THEMES.filter((theme) => theme.collection === "fantasy");
