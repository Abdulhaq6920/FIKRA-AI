/**
 * Original chibi-ninja illustrations for the two anime themes.
 *
 * These are hand-built SVGs (no external or copyrighted assets) so the themes
 * stay fast, offline-friendly, and safe to ship.
 */

export function NinjaArtwork({
  variant,
  className,
}: {
  variant: "leaf" | "sharingan";
  className?: string;
}) {
  return variant === "leaf" ? (
    <LeafNinja className={className} />
  ) : (
    <SharinganNinja className={className} />
  );
}

function LeafNinja({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 320 230"
      role="img"
      aria-label="Original chibi ninja illustration in warm leaf-village colours"
      className={className}
    >
      <defs>
        <linearGradient id="leaf-sun" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fbbf24" />
          <stop offset="1" stopColor="#f97316" />
        </linearGradient>
        <linearGradient id="leaf-jacket" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fb923c" />
          <stop offset="1" stopColor="#ea580c" />
        </linearGradient>
        <linearGradient id="leaf-plate" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#dbeafe" />
          <stop offset="0.5" stopColor="#94a3b8" />
          <stop offset="1" stopColor="#64748b" />
        </linearGradient>
        <radialGradient id="leaf-skin" cx="0.35" cy="0.25" r="0.9">
          <stop offset="0" stopColor="#ffe8c7" />
          <stop offset="1" stopColor="#f6c794" />
        </radialGradient>
        <filter id="leaf-soft" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="7" stdDeviation="6" floodColor="#7c2d12" floodOpacity="0.28" />
        </filter>
      </defs>

      <circle cx="251" cy="56" r="41" fill="url(#leaf-sun)" opacity="0.2" />
      <circle cx="251" cy="56" r="29" fill="url(#leaf-sun)" opacity="0.38" />

      <path
        d="M18 190c30-42 55-36 79-20 21-31 47-33 68-6 20-23 47-25 66-3 17-16 38-19 71 29H18Z"
        fill="#bbf7d0"
        opacity="0.55"
      />
      <path
        d="M8 201c37-28 66-20 91-8 26-18 53-17 76 2 27-15 55-14 82 4 20-9 38-8 55 2H8Z"
        fill="#86efac"
        opacity="0.35"
      />

      <g filter="url(#leaf-soft)">
        <ellipse cx="159" cy="208" rx="75" ry="11" fill="#7c2d12" opacity="0.18" />

        {/* Legs */}
        <path d="M131 172h25v20c0 6-5 10-11 10h-14v-30Z" fill="#1e293b" />
        <path d="M161 172h25v30h-14c-6 0-11-4-11-10v-20Z" fill="#334155" />
        <path d="M123 199h27c3 0 5 3 4 6l-1 4h-34l1-5c1-3 1-5 3-5Z" fill="#0f172a" />
        <path d="M159 199h27c3 0 5 3 4 6l-1 4h-34l1-5c1-3 1-5 3-5Z" fill="#0f172a" />

        {/* Body */}
        <path
          d="M117 119c5-13 18-20 40-20s36 7 41 20l8 55c-25 10-75 10-99 0l10-55Z"
          fill="url(#leaf-jacket)"
        />
        <path d="M157 100h1c8 0 14 6 14 14v59h-29v-59c0-8 6-14 14-14Z" fill="#f8fafc" opacity="0.38" />
        <path d="M122 156c16-6 28-6 41 0v18c-15 5-29 5-45 0l4-18Z" fill="#1e293b" />
        <circle cx="159" cy="164" r="4" fill="#fbbf24" />

        {/* Arms crossed */}
        <path
          d="M123 121c-14 9-22 23-23 38-1 7 3 13 10 14 7 1 12-4 15-10l9-19-11-23Z"
          fill="#ea580c"
        />
        <path
          d="M191 125c13 8 21 20 23 34 1 7-3 13-10 14-7 1-12-4-15-10l-9-18 11-20Z"
          fill="#f97316"
        />
        <path d="M112 165c6 2 11 0 14-5l8-14 12 7-9 17c-5 9-15 12-23 7l-2-12Z" fill="#f6c794" />
        <path d="M205 164c-6 2-11 0-14-5l-8-14-12 7 9 17c5 9 15 12 23 7l2-12Z" fill="#f6c794" />

        {/* Head */}
        <circle cx="159" cy="80" r="39" fill="url(#leaf-skin)" />
        <path
          d="M121 76c-3-25 14-44 38-44s42 18 39 45c-3-9-8-15-14-19-8 7-20 10-36 10-9 0-17 2-24 6l-3 2Z"
          fill="#facc15"
        />
        <path d="M124 63l-4-18 14 9 3-17 12 12 8-17 6 16 13-9-1 19 13-2-9 15-55-8Z" fill="#fde047" />
        <path d="M129 68c8-4 18-6 30-6s22 2 30 5" fill="none" stroke="#ca8a04" strokeWidth="3" strokeLinecap="round" opacity="0.55" />

        {/* Headband */}
        <path d="M120 66c23-8 56-8 79 0l1 13c-25 8-56 8-80 0l0-13Z" fill="#1e3a8a" />
        <rect x="139" y="63" width="42" height="20" rx="4" fill="url(#leaf-plate)" stroke="#475569" strokeWidth="2" />
        <path
          d="M166 68c-6-4-13 0-11 5 1 3 6 2 7 5 1 4-5 6-9 3M160 74l-2 9"
          fill="none"
          stroke="#334155"
          strokeWidth="2.4"
          strokeLinecap="round"
        />

        {/* Face */}
        <ellipse cx="145" cy="91" rx="5" ry="6.5" fill="#0f172a" />
        <ellipse cx="174" cy="91" rx="5" ry="6.5" fill="#0f172a" />
        <circle cx="146.5" cy="89" r="1.8" fill="#fff" />
        <circle cx="175.5" cy="89" r="1.8" fill="#fff" />
        <path d="M153 101c4 4 9 4 13 0" fill="none" stroke="#7c2d12" strokeWidth="2.6" strokeLinecap="round" />
        <path d="M133 99l7-2M133 104l7-2M185 99l-7-2M185 104l-7-2" stroke="#b45309" strokeWidth="1.8" strokeLinecap="round" opacity="0.65" />

        {/* Chakra spark */}
        <path d="M86 101l7-18 4 12 9-5-11 21-2-10-7 0Z" fill="#22d3ee" opacity="0.7" />
        <circle cx="85" cy="118" r="3" fill="#22d3ee" opacity="0.5" />
      </g>
    </svg>
  );
}

function SharinganNinja({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 320 230"
      role="img"
      aria-label="Original chibi ninja illustration with a crimson dōjutsu eye"
      className={className}
    >
      <defs>
        <radialGradient id="share-moon" cx="0.4" cy="0.4" r="0.7">
          <stop offset="0" stopColor="#fecaca" />
          <stop offset="0.55" stopColor="#ef4444" />
          <stop offset="1" stopColor="#7f1d1d" />
        </radialGradient>
        <linearGradient id="share-cloak" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#334155" />
          <stop offset="1" stopColor="#0f172a" />
        </linearGradient>
        <radialGradient id="share-skin" cx="0.35" cy="0.25" r="0.9">
          <stop offset="0" stopColor="#ffe4d6" />
          <stop offset="1" stopColor="#eab69c" />
        </radialGradient>
        <radialGradient id="share-eye" cx="0.5" cy="0.5" r="0.55">
          <stop offset="0" stopColor="#ff6b6b" />
          <stop offset="0.45" stopColor="#dc2626" />
          <stop offset="1" stopColor="#7f1d1d" />
        </radialGradient>
        <filter id="share-glow" x="-80%" y="-80%" width="260%" height="260%">
          <feDropShadow dx="0" dy="0" stdDeviation="6" floodColor="#ef4444" floodOpacity="0.85" />
        </filter>
        <filter id="share-soft" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="7" stdDeviation="6" floodColor="#000" floodOpacity="0.55" />
        </filter>
      </defs>

      <circle cx="251" cy="55" r="34" fill="url(#share-moon)" opacity="0.72" filter="url(#share-glow)" />
      <circle cx="262" cy="46" r="31" fill="#0b0505" opacity="0.92" />
      <path d="M18 193c34-38 61-30 86-12 24-28 51-27 73-2 21-19 48-18 69 2 18-13 39-12 68 25H18Z" fill="#3f1d1d" opacity="0.55" />
      <path d="M7 204c39-24 70-17 96-4 27-16 55-15 80 2 25-12 51-11 74 4 18-8 34-7 49 1H7Z" fill="#7f1d1d" opacity="0.24" />

      <g filter="url(#share-soft)">
        <ellipse cx="159" cy="209" rx="76" ry="11" fill="#000" opacity="0.4" />

        {/* Cloak / legs */}
        <path d="M116 122c7-15 20-23 43-23s37 8 44 23l11 53c-30 12-79 12-109 0l11-53Z" fill="url(#share-cloak)" />
        <path d="M156 100h5c9 0 16 7 16 16v64c-12 5-25 5-37 0v-64c0-9 7-16 16-16Z" fill="#1e293b" />
        <path d="M126 175h25v18c0 6-5 10-11 10h-14v-28Z" fill="#0f172a" />
        <path d="M161 175h26v28h-15c-6 0-11-4-11-10v-18Z" fill="#1e293b" />
        <path d="M118 200h29c3 0 5 3 4 6l-1 4h-36l1-5c1-3 1-5 3-5Z" fill="#020617" />
        <path d="M158 200h29c3 0 5 3 4 6l-1 4h-36l1-5c1-3 1-5 3-5Z" fill="#020617" />

        {/* Crimson scarf */}
        <path d="M119 119c19-9 61-9 81 0l-5 16c-19-7-53-7-72 0l-4-16Z" fill="#991b1b" />
        <path d="M195 130c20 8 29 22 27 42-1 7-7 11-13 9-5-2-7-7-7-12l-9-28 2-11Z" fill="#b91c1c" />
        <path d="M209 176l13 16-10 4-9-16 6-4Z" fill="#7f1d1d" />

        {/* Arms */}
        <path d="M124 126c-12 9-19 22-19 36 0 7 5 12 12 12 6 0 10-4 12-9l8-20-13-19Z" fill="#334155" />
        <path d="M193 128c11 8 18 20 18 34 0 7-5 12-12 12-6 0-10-4-12-9l-7-19 13-18Z" fill="#475569" />
        <path d="M113 172c6 2 11 0 14-5l7-13 11 7-8 16c-5 8-14 11-22 6l-2-11Z" fill="url(#share-skin)" />
        <path d="M204 171c-6 2-11 0-14-5l-7-13-11 7 8 16c5 8 14 11 22 6l2-11Z" fill="url(#share-skin)" />

        {/* Head */}
        <circle cx="159" cy="80" r="39" fill="url(#share-skin)" />
        <path
          d="M117 80c-6-29 16-49 42-49 28 0 47 20 43 51-4-10-10-17-18-20-10 8-26 11-43 10-9 0-17 3-22 8h-2Z"
          fill="#0f172a"
        />
        <path d="M122 55l-9-14 16 3-1-17 14 10 7-16 9 15 12-12 3 17 15-6-7 20-59 3Z" fill="#111827" />

        {/* Headband */}
        <path d="M120 67c23-8 56-8 79 0l1 12c-25 8-56 8-80 0l0-12Z" fill="#020617" />
        <rect x="139" y="64" width="42" height="20" rx="4" fill="#334155" stroke="#64748b" strokeWidth="2" />
        <path d="M166 69c-6-4-13 0-11 5 1 3 6 2 7 5 1 4-5 6-9 3" fill="none" stroke="#94a3b8" strokeWidth="1.8" strokeLinecap="round" opacity="0.8" />

        {/* Face + sharingan eye */}
        <ellipse cx="145" cy="92" rx="5" ry="6.5" fill="#0f172a" />
        <g filter="url(#share-glow)">
          <circle cx="175" cy="91" r="9.5" fill="url(#share-eye)" />
          <circle cx="175" cy="91" r="3.2" fill="#0f172a" />
          <circle cx="175" cy="85.5" r="1.6" fill="#0f172a" />
          <circle cx="180" cy="93.5" r="1.6" fill="#0f172a" />
          <circle cx="170" cy="93.5" r="1.6" fill="#0f172a" />
        </g>
        <path d="M151 103c4 3 9 3 13 0" fill="none" stroke="#7f1d1d" strokeWidth="2.6" strokeLinecap="round" />
        <path d="M137 78l13-3M183 77l-12-2" stroke="#0f172a" strokeWidth="2.6" strokeLinecap="round" />

        {/* Lightning accents */}
        <path d="M83 90l12-28 1 16 11-7-16 31-1-13-7 1Z" fill="#f87171" opacity="0.8" />
        <path d="M238 116l7-19 2 11 8-4-11 20-1-9-5 1Z" fill="#fca5a5" opacity="0.6" />
        <circle cx="84" cy="116" r="2.5" fill="#ef4444" opacity="0.6" />
      </g>
    </svg>
  );
}
