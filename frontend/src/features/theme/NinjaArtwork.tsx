/**
 * Original anime-themed character illustrations.
 *
 * Ninja worlds are defined here; Solo Leveling worlds live in SoloArtwork.
 * Everything is a hand-built SVG (no external or copyrighted assets) so the
 * themes stay fast, offline-friendly, and safe to ship. Both ninja portraits
 * are drawn as anime key visuals — cel planes, ink linework and oversized
 * expressive eyes — rather than mascot art.
 */

import type { CSSProperties } from "react";
import { SoloArtwork } from "./SoloArtwork";
import type { ThemeArtwork } from "./themes";

export function NinjaArtwork({
  variant,
  className,
  style,
}: {
  variant: ThemeArtwork;
  className?: string;
  style?: CSSProperties;
}) {
  if (variant === "jinwoo" || variant === "igris") {
    return <SoloArtwork variant={variant} className={className} style={style} />;
  }
  return variant === "leaf" ? (
    <LeafNinja className={className} style={style} />
  ) : (
    <SharinganNinja className={className} style={style} />
  );
}

function LeafNinja({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <svg
      viewBox="0 0 320 240"
      role="img"
      aria-label="Original anime-style ninja portrait with blond hair and a leaf headband"
      className={className}
      style={style}
    >
      <defs>
        <radialGradient id="leaf-sun" cx="0.5" cy="0.5" r="0.55">
          <stop offset="0" stopColor="#fef9c3" />
          <stop offset="0.45" stopColor="#fbbf24" />
          <stop offset="1" stopColor="#c2410c" />
        </radialGradient>
        <linearGradient id="leaf-jacket" x1="0.1" y1="0" x2="0.7" y2="1">
          <stop offset="0" stopColor="#fb923c" />
          <stop offset="0.5" stopColor="#ea580c" />
          <stop offset="1" stopColor="#9a3412" />
        </linearGradient>
        <linearGradient id="leaf-hair" x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0" stopColor="#fef08a" />
          <stop offset="0.45" stopColor="#facc15" />
          <stop offset="1" stopColor="#ca8a04" />
        </linearGradient>
        <linearGradient id="leaf-plate" x1="0" y1="0" x2="0.6" y2="1">
          <stop offset="0" stopColor="#e2e8f0" />
          <stop offset="0.5" stopColor="#94a3b8" />
          <stop offset="1" stopColor="#475569" />
        </linearGradient>
        <radialGradient id="leaf-skin" cx="0.36" cy="0.24" r="0.95">
          <stop offset="0" stopColor="#ffe8c7" />
          <stop offset="0.55" stopColor="#f6c794" />
          <stop offset="1" stopColor="#d99a63" />
        </radialGradient>
        <linearGradient id="leaf-skin-sh" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#eab887" />
          <stop offset="1" stopColor="#c98d5c" />
        </linearGradient>
        <radialGradient id="leaf-iris" cx="0.42" cy="0.34" r="0.7">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.3" stopColor="#bae6fd" />
          <stop offset="0.68" stopColor="#38bdf8" />
          <stop offset="1" stopColor="#0369a1" />
        </radialGradient>
        <filter id="leaf-soft" x="-40%" y="-40%" width="180%" height="180%">
          <feDropShadow dx="0" dy="8" stdDeviation="7" floodColor="#7c2d12" floodOpacity="0.32" />
        </filter>
        <filter id="leaf-glow" x="-90%" y="-90%" width="280%" height="280%">
          <feDropShadow dx="0" dy="0" stdDeviation="6" floodColor="#22d3ee" floodOpacity="0.9" />
        </filter>
      </defs>

      {/* Hidden-village sun */}
      <circle cx="252" cy="58" r="46" fill="url(#leaf-sun)" opacity="0.24" />
      <circle cx="252" cy="58" r="31" fill="url(#leaf-sun)" opacity="0.4" />

      {/* Rooftops */}
      <path
        d="M6 210c40-26 76-19 108-2 30-16 62-15 90 2 28-12 57-11 82 3 14-4 28-3 42 3H6Z"
        fill="#86efac"
        opacity="0.32"
      />

      <g filter="url(#leaf-soft)">
        {/* Jacket shoulders */}
        <path
          d="M160 164c30 0 58 8 81 23 24 16 38 38 40 53H35c2-15 16-37 40-53 23-15 51-23 81-23Z"
          fill="url(#leaf-jacket)"
        />
        {/* Zip line + collar */}
        <path d="M160 166v74" stroke="#f8fafc" strokeWidth="4" opacity="0.4" />
        <path d="M126 168l34 24 34-24 10 10-44 34-44-34 10-10Z" fill="#1e293b" />
        <path d="M152 176h16l-8 12-8-12Z" fill="#fbbf24" />
        {/* Pauldron seams */}
        <path d="M102 176c-16 9-27 24-31 42" fill="none" stroke="#9a3412" strokeWidth="4" opacity="0.7" />
        <path d="M218 176c16 9 27 24 31 42" fill="none" stroke="#9a3412" strokeWidth="4" opacity="0.7" />

        {/* Neck */}
        <path d="M143 134h34v30c0 7-8 12-17 12s-17-5-17-12v-30Z" fill="url(#leaf-skin-sh)" />
        <path d="M143 134h34v8c-11 5-23 5-34 0v-8Z" fill="#b87a4a" opacity="0.5" />

        {/* Ears */}
        <ellipse cx="104" cy="97" rx="7" ry="12" fill="#f6c794" />
        <ellipse cx="216" cy="97" rx="7" ry="12" fill="#f6c794" />

        {/* Back hair */}
        <path
          d="M101 110C88 62 116 20 160 20c44 0 72 42 59 90-6-13-10-25-12-36-18 10-44 13-72 6-13-3-24-1-34 30Z"
          fill="url(#leaf-hair)"
        />
        {/* Spiky silhouette */}
        <path
          d="M110 70l-13-19 21 6-3-22 18 14 6-22 14 18 13-17 6 20 18-10-4 22 20-1-15 18-73 3Z"
          fill="url(#leaf-hair)"
        />

        {/* Face */}
        <path
          d="M160 26c36 0 57 24 57 62 0 20-6 37-17 48-10 11-24 18-40 20-16-2-30-9-40-20-11-11-17-28-17-48 0-38 21-62 57-62Z"
          fill="url(#leaf-skin)"
          stroke="#9a5b35"
          strokeOpacity="0.3"
          strokeWidth="1.1"
        />
        <path
          d="M199 62c10 20 9 44-3 62-8 12-20 21-34 25 18-4 32-14 40-28 9-17 10-38 3-57l-6-2Z"
          fill="#d99a63"
          opacity="0.38"
        />

        {/* Eyes */}
        <g className="anime-eyes">
          <path d="M116 96c9-11 28-12 38-1-7 12-28 14-38 1Z" fill="#f8fafc" />
          <path d="M166 95c10-11 29-10 38 1-10 13-31 11-38-1Z" fill="#f8fafc" />
          <ellipse cx="134" cy="97" rx="7" ry="8.6" fill="url(#leaf-iris)" />
          <ellipse cx="186" cy="97" rx="7" ry="8.6" fill="url(#leaf-iris)" />
          <ellipse cx="134" cy="98" rx="3.1" ry="4.6" fill="#082f49" />
          <ellipse cx="186" cy="98" rx="3.1" ry="4.6" fill="#082f49" />
          <circle cx="131.4" cy="93.2" r="2.4" fill="#ffffff" />
          <circle cx="183.4" cy="93.2" r="2.4" fill="#ffffff" />
          <circle cx="137.2" cy="101" r="1.3" fill="#e0f2fe" opacity="0.9" />
          <circle cx="189.2" cy="101" r="1.3" fill="#e0f2fe" opacity="0.9" />
          <path
            d="M114 95c9-12 30-13 40-2"
            fill="none"
            stroke="#3f2a12"
            strokeWidth="3.4"
            strokeLinecap="round"
          />
          <path
            d="M166 93c10-12 31-11 40 2"
            fill="none"
            stroke="#3f2a12"
            strokeWidth="3.4"
            strokeLinecap="round"
          />
        </g>

        {/* Whisker marks + grin */}
        <path
          d="M124 112l10-2M124 118l10-2M196 112l-10-2M196 118l-10-2"
          stroke="#b45309"
          strokeWidth="1.8"
          strokeLinecap="round"
          opacity="0.55"
        />
        <path
          d="M148 126c8 6 16 6 24 0"
          fill="none"
          stroke="#8a4a1f"
          strokeWidth="2.6"
          strokeLinecap="round"
        />
        <path
          d="M161 108l-4 7h7"
          fill="none"
          stroke="#c98d5c"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Front fringe above the headband */}
        <path
          d="M104 80C100 46 124 24 160 24c37 0 61 23 56 57l-9-12-2 14-9-18-6 18-10-20-8 18-10-19-8 17-9-16-6 15-8-14-4 17-9-15-5 12Z"
          fill="url(#leaf-hair)"
        />
        <path
          d="M123 42c14-11 34-15 52-8"
          fill="none"
          stroke="#fef9c3"
          strokeWidth="2.4"
          strokeLinecap="round"
          opacity="0.75"
        />
        {/* Side locks */}
        <path d="M106 74c-4 16-3 31 2 44l-9-7c-4-13-4-26 1-39l6 2Z" fill="url(#leaf-hair)" />
        <path d="M214 74c4 16 3 31-2 44l9-7c4-13 4-26-1-39l-6 2Z" fill="url(#leaf-hair)" />

        {/* Headband */}
        <path d="M103 78c32-10 82-10 114 0l1 15c-36 11-80 11-116 0l1-15Z" fill="#1e3a8a" />
        <path d="M103 78c32-10 82-10 114 0l-2 7c-34-9-76-9-110 0l-2-7Z" fill="#2f4bb0" opacity="0.9" />
        <rect
          x="137"
          y="74"
          width="46"
          height="22"
          rx="4"
          fill="url(#leaf-plate)"
          stroke="#475569"
          strokeWidth="2"
        />
        <path
          d="M166 79c-6-4-13 0-11 5 1 3 6 2 7 5 1 4-5 6-9 3M160 85l-2 9"
          fill="none"
          stroke="#334155"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
        {/* Headband tails */}
        <path d="M214 82c10 6 16 16 17 28l-11-4c-1-8-4-15-9-20l3-4Z" fill="#1e3a8a" />
        <path d="M216 92c6 8 9 17 9 27l-8-6c0-7-2-13-5-18l4-3Z" fill="#2f4bb0" opacity="0.9" />

        {/* Chunin vest collar over the jacket */}
        <path d="M124 172c11 5 24 8 36 8s25-3 36-8l-5 16c-9 4-20 6-31 6s-22-2-31-6l-5-16Z" fill="#1e293b" opacity="0.9" />

        {/* Chakra orb */}
        <g className="anime-aura" filter="url(#leaf-glow)">
          <circle cx="258" cy="146" r="7" fill="#67e8f9" opacity="0.9" />
          <circle cx="258" cy="146" r="12" fill="none" stroke="#22d3ee" strokeWidth="1.4" opacity="0.6" />
          <circle cx="270" cy="158" r="2.2" fill="#a5f3fc" opacity="0.8" />
          <circle cx="248" cy="160" r="1.6" fill="#67e8f9" opacity="0.7" />
        </g>
      </g>

      {/* Leaves in the wind */}
      <g fill="#fde047" opacity="0.75">
        <path d="M78 72c6-8 16-9 22-4-3 8-13 12-22 4Z" />
        <path d="M292 118c5-6 13-7 18-3-3 7-11 9-18 3Z" opacity="0.6" />
      </g>
    </svg>
  );
}

function SharinganNinja({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <svg
      viewBox="0 0 320 240"
      role="img"
      aria-label="Original anime-style ninja portrait with a crimson dōjutsu eye"
      className={className}
      style={style}
    >
      <defs>
        <radialGradient id="share-moon" cx="0.4" cy="0.4" r="0.7">
          <stop offset="0" stopColor="#fecaca" />
          <stop offset="0.55" stopColor="#ef4444" />
          <stop offset="1" stopColor="#7f1d1d" />
        </radialGradient>
        <linearGradient id="share-cloak" x1="0.1" y1="0" x2="0.7" y2="1">
          <stop offset="0" stopColor="#3b4a66" />
          <stop offset="0.5" stopColor="#1e293b" />
          <stop offset="1" stopColor="#080d18" />
        </linearGradient>
        <linearGradient id="share-hair" x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0" stopColor="#334155" />
          <stop offset="0.45" stopColor="#111827" />
          <stop offset="1" stopColor="#020617" />
        </linearGradient>
        <radialGradient id="share-skin" cx="0.36" cy="0.24" r="0.95">
          <stop offset="0" stopColor="#ffe4d6" />
          <stop offset="0.55" stopColor="#eec0a8" />
          <stop offset="1" stopColor="#cf9a80" />
        </radialGradient>
        <linearGradient id="share-skin-sh" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#dca78f" />
          <stop offset="1" stopColor="#b07b63" />
        </linearGradient>
        <radialGradient id="share-eye" cx="0.45" cy="0.4" r="0.62">
          <stop offset="0" stopColor="#ff8080" />
          <stop offset="0.4" stopColor="#dc2626" />
          <stop offset="1" stopColor="#6b0d0d" />
        </radialGradient>
        <filter id="share-glow" x="-90%" y="-90%" width="280%" height="280%">
          <feDropShadow dx="0" dy="0" stdDeviation="6" floodColor="#ef4444" floodOpacity="0.9" />
        </filter>
        <filter id="share-soft" x="-40%" y="-40%" width="180%" height="180%">
          <feDropShadow dx="0" dy="8" stdDeviation="7" floodColor="#000000" floodOpacity="0.6" />
        </filter>
      </defs>

      {/* Blood moon */}
      <circle cx="252" cy="54" r="38" fill="url(#share-moon)" opacity="0.8" filter="url(#share-glow)" />
      <circle cx="266" cy="46" r="33" fill="#0b0505" opacity="0.9" />

      {/* Dark treeline */}
      <path
        d="M6 210c40-24 76-17 108 0 30-15 62-14 90 2 28-11 57-10 82 3 14-4 28-3 42 3H6Z"
        fill="#7f1d1d"
        opacity="0.26"
      />

      <g filter="url(#share-soft)">
        {/* Cloak shoulders */}
        <path
          d="M160 162c30 0 58 8 81 24 24 16 38 39 40 54H35c2-15 16-38 40-54 23-16 51-24 81-24Z"
          fill="url(#share-cloak)"
        />
        {/* High collar */}
        <path d="M124 167c12 8 24 12 36 12s24-4 36-12l7 17c-13 8-28 12-43 12s-30-4-43-12l7-17Z" fill="#0f172a" />
        <path d="M138 175c7 5 15 8 22 8s15-3 22-8" fill="none" stroke="#64748b" strokeWidth="1.6" opacity="0.5" />

        {/* Neck */}
        <path d="M143 134h34v30c0 7-8 12-17 12s-17-5-17-12v-30Z" fill="url(#share-skin-sh)" />
        <path d="M143 134h34v8c-11 5-23 5-34 0v-8Z" fill="#a26a52" opacity="0.55" />

        {/* Ears */}
        <ellipse cx="104" cy="97" rx="7" ry="12" fill="#e8b9a0" />
        <ellipse cx="216" cy="97" rx="7" ry="12" fill="#e8b9a0" />

        {/* Back hair */}
        <path
          d="M99 112C86 60 116 18 160 18c46 0 76 42 62 94-6-16-12-29-20-38-16 12-38 16-64 10-14-3-26 2-39 28Z"
          fill="url(#share-hair)"
        />
        <path
          d="M104 74l-12-22 24 4 1-22 18 16 9-21 14 19 15-17 5 21 18-7-8 22-84 7Z"
          fill="url(#share-hair)"
        />
        {/* Crown spikes */}
        <path
          d="M122 56l-12-22 20 8-1-20 17 15 7-20 13 18 13-16 5 19 17-9-6 21 17-3-12 18-78-9Z"
          fill="url(#share-hair)"
        />

        {/* Face */}
        <path
          d="M160 26c36 0 57 24 57 62 0 20-6 37-17 48-10 11-24 18-40 20-16-2-30-9-40-20-11-11-17-28-17-48 0-38 21-62 57-62Z"
          fill="url(#share-skin)"
          stroke="#8a5740"
          strokeOpacity="0.32"
          strokeWidth="1.1"
        />
        <path
          d="M199 62c10 20 9 44-3 62-8 12-20 21-34 25 18-4 32-14 40-28 9-17 10-38 3-57l-6-2Z"
          fill="#c9927a"
          opacity="0.4"
        />

        {/* Left eye — calm charcoal */}
        <g className="anime-eyes">
          <path d="M116 96c9-10 27-11 37-1-7 11-27 13-37 1Z" fill="#f8fafc" />
          <ellipse cx="134" cy="97" rx="6.4" ry="8" fill="#1f2937" />
          <ellipse cx="134" cy="97.5" rx="2.9" ry="4.2" fill="#05070d" />
          <circle cx="131.6" cy="93.4" r="2.1" fill="#ffffff" />
          <path
            d="M114 95c9-11 29-12 39-2"
            fill="none"
            stroke="#0a0a14"
            strokeWidth="3.4"
            strokeLinecap="round"
          />
        </g>

        {/* Right eye — dōjutsu */}
        <g className="anime-eyes" filter="url(#share-glow)">
          <path d="M166 95c10-10 28-10 38 0-9 13-29 12-38 0Z" fill="#fee2e2" />
          <circle cx="186" cy="97" r="8.4" fill="url(#share-eye)" />
          <circle cx="186" cy="97.5" r="2.6" fill="#1a0505" />
          <g fill="#1a0505">
            <circle cx="186" cy="90.4" r="1.7" />
            <circle cx="191.5" cy="99.5" r="1.7" />
            <circle cx="180.5" cy="99.5" r="1.7" />
          </g>
          <g fill="#1a0505" opacity="0.85">
            <path d="M186 92.4c2 1 2 3 0 4-2-1-2-3 0-4Z" />
            <path d="M189.4 99.4c-.6 2-2.6 2.4-3.4.6 1.4-1.4 2.8-1.6 3.4-.6Z" />
            <path d="M182.6 99.4c.6 2 2.6 2.4 3.4.6-1.4-1.4-2.8-1.6-3.4-.6Z" />
          </g>
          <circle cx="183.6" cy="93.4" r="2.1" fill="#ffffff" />
          <path
            d="M166 93c10-11 29-11 39 0"
            fill="none"
            stroke="#0a0a14"
            strokeWidth="3.6"
            strokeLinecap="round"
          />
        </g>

        {/* Brows, nose, mouth */}
        <path
          d="M112 79c11-6 28-6 38 0"
          fill="none"
          stroke="#0f172a"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <path
          d="M170 79c10-6 27-6 38 0"
          fill="none"
          stroke="#0f172a"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <path
          d="M161 108l-4 7h7"
          fill="none"
          stroke="#b07b63"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M152 128c5 2 11 2 16 0"
          fill="none"
          stroke="#7c3f4c"
          strokeWidth="2.2"
          strokeLinecap="round"
        />

        {/* Bangs falling over the headband */}
        <path
          d="M103 100C98 56 124 24 160 24c37 0 63 30 58 72l-9-18-2 22-11-24-6 24-11-26-8 24-11-24-8 22-9-20-6 19-9-18-5 22-9-20-5 17Z"
          fill="url(#share-hair)"
        />
        <path
          d="M126 46c13-11 33-16 51-9"
          fill="none"
          stroke="#64748b"
          strokeWidth="2.4"
          strokeLinecap="round"
          opacity="0.6"
        />

        {/* Headband */}
        <path d="M104 74c32-9 80-9 112 0l1 14c-35 10-79 10-114 0l1-14Z" fill="#020617" />
        <rect
          x="138"
          y="71"
          width="44"
          height="20"
          rx="4"
          fill="#334155"
          stroke="#64748b"
          strokeWidth="2"
        />
        <path
          d="M165 76c-6-4-13 0-11 5 1 3 6 2 7 5 1 4-5 6-9 3"
          fill="none"
          stroke="#94a3b8"
          strokeWidth="1.8"
          strokeLinecap="round"
          opacity="0.85"
        />

        {/* Crimson scarf */}
        <path d="M124 156c24-6 48-6 72 0l5 12c-26-6-56-6-82 0l5-12Z" fill="#991b1b" />
        <path
          className="anime-cloak"
          d="M196 162c18 6 28 18 28 34 0 6-5 10-11 9-5-1-8-5-9-10l-10-26 2-7Z"
          fill="#b91c1c"
        />
        <path d="M209 200l12 14-9 4-8-15 5-3Z" fill="#7f1d1d" />

        {/* Lightning accents */}
        <path d="M80 88l12-28 1 16 11-7-16 31-1-13-7 1Z" fill="#f87171" opacity="0.8" />
        <path d="M244 118l7-19 2 11 8-4-11 20-1-9-5 1Z" fill="#fca5a5" opacity="0.6" />
      </g>
    </svg>
  );
}
