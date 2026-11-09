/**
 * Original Solo Leveling-inspired character art.
 *
 * Hand-built SVG only — no external or copyrighted assets. Both figures are
 * drawn as anime key-visual busts: angular ink faces, cel-shaded planes, and
 * luminous eyes, so they read as illustration rather than mascot clip-art at
 * both the 28px sidebar size and the full companion panel.
 */

import type { CSSProperties } from "react";

export function SoloArtwork({
  variant,
  className,
  style,
}: {
  variant: "jinwoo" | "igris";
  className?: string;
  style?: CSSProperties;
}) {
  return variant === "jinwoo" ? (
    <ShadowMonarch className={className} style={style} />
  ) : (
    <CrimsonKnight className={className} style={style} />
  );
}

function ShadowMonarch({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <svg
      viewBox="0 0 320 240"
      role="img"
      aria-label="Original anime-style shadow monarch portrait with violet mana eyes"
      className={className}
      style={style}
    >
      <defs>
        <radialGradient id="jin-portal" cx="0.5" cy="0.5" r="0.55">
          <stop offset="0" stopColor="#e0e7ff" />
          <stop offset="0.3" stopColor="#6366f1" />
          <stop offset="0.7" stopColor="#312e81" />
          <stop offset="1" stopColor="#05060f" />
        </radialGradient>
        <linearGradient id="jin-hair" x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0" stopColor="#1b2038" />
          <stop offset="0.45" stopColor="#0a0d1b" />
          <stop offset="1" stopColor="#04050a" />
        </linearGradient>
        <linearGradient id="jin-coat" x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0" stopColor="#151a33" />
          <stop offset="0.55" stopColor="#0a0c18" />
          <stop offset="1" stopColor="#04050a" />
        </linearGradient>
        <linearGradient id="jin-trim" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#c7d2fe" />
          <stop offset="0.45" stopColor="#818cf8" />
          <stop offset="1" stopColor="#4338ca" />
        </linearGradient>
        <radialGradient id="jin-skin" cx="0.36" cy="0.24" r="0.95">
          <stop offset="0" stopColor="#ffeadf" />
          <stop offset="0.55" stopColor="#f3ceb7" />
          <stop offset="1" stopColor="#d6a28b" />
        </radialGradient>
        <linearGradient id="jin-skin-sh" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e4b69c" />
          <stop offset="1" stopColor="#bd876c" />
        </linearGradient>
        <radialGradient id="jin-iris" cx="0.42" cy="0.36" r="0.7">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.24" stopColor="#cfd1da" />
          <stop offset="0.58" stopColor="#a78bfa" />
          <stop offset="1" stopColor="#4c1d95" />
        </radialGradient>
        <filter id="jin-glow" x="-90%" y="-90%" width="280%" height="280%">
          <feDropShadow dx="0" dy="0" stdDeviation="6" floodColor="#8b5cf6" floodOpacity="0.95" />
        </filter>
        <filter id="jin-soft" x="-40%" y="-40%" width="180%" height="180%">
          <feDropShadow dx="0" dy="8" stdDeviation="7" floodColor="#020617" floodOpacity="0.7" />
        </filter>
      </defs>

      {/* Dimensional gate behind the figure */}
      <circle
        className="anime-aura"
        cx="252"
        cy="58"
        r="50"
        fill="url(#jin-portal)"
        opacity="0.34"
      />
      <circle cx="252" cy="58" r="35" fill="none" stroke="#a5b4fc" strokeWidth="1.6" opacity="0.55" />
      <circle cx="252" cy="58" r="25" fill="none" stroke="#c7d2fe" strokeWidth="1" opacity="0.35" />

      {/* Shadow realm floor */}
      <path
        d="M4 214c40-22 74-16 104 0 29-14 60-13 88 1 28-11 57-10 82 2 16-5 33-4 48 3H4Z"
        fill="#4338ca"
        opacity="0.2"
      />

      <g filter="url(#jin-soft)">
        {/* Coat shoulders */}
        <path
          d="M160 166c30 0 58 8 81 23 24 16 38 38 40 51H35c2-13 16-35 40-51 23-15 51-23 81-23Z"
          fill="url(#jin-coat)"
        />
        {/* Open collar */}
        <path d="M126 168l34 26 34-26 11 8-45 44-45-44 11-8Z" fill="#070a18" />
        <path d="M160 192l8 10-8 21-8-21 8-10Z" fill="url(#jin-trim)" />
        <path d="M128 174l32 25-8 6-30-25 6-6Z" fill="#312e81" opacity="0.6" />
        <path d="M192 174l-32 25 8 6 30-25-6-6Z" fill="#312e81" opacity="0.6" />

        {/* Pauldrons */}
        <path d="M100 176c-19 7-33 24-38 47l-3 17h36l5-34 13-27-13-3Z" fill="#171a36" />
        <path d="M220 176c19 7 33 24 38 47l3 17h-36l-5-34-13-27 13-3Z" fill="#171a36" />
        <path d="M98 181l-27 15 22 7 17-13-12-9Z" fill="#6366f1" opacity="0.6" />
        <path d="M222 181l27 15-22 7-17-13 12-9Z" fill="#6366f1" opacity="0.6" />
        <path d="M88 206l16-2 4 7-16 3-4-8Z" fill="#a5b4fc" opacity="0.5" />
        <path d="M232 206l-16-2-4 7 16 3 4-8Z" fill="#a5b4fc" opacity="0.5" />

        {/* Twin daggers — his signature short blades, crossed behind the coat. */}
        <g opacity="0.95">
          <g className="anime-blade" transform="rotate(-24 76 150)">
            <path d="M70 208 78 108 84 82 90 112 82 208Z" fill="#c7d2fe" opacity="0.26" />
            <path d="M78 106 84 82 88 110 82 200Z" fill="#e0e7ff" opacity="0.72" />
            <path d="M84 84 88 110" stroke="#ffffff" strokeWidth="1.4" opacity="0.8" />
            <rect x="68" y="196" width="20" height="5" rx="2.5" fill="#312e81" />
            <rect x="75" y="201" width="6" height="16" rx="3" fill="#151a33" />
          </g>
          <g className="anime-blade" transform="rotate(24 244 150)">
            <path d="M250 208 242 108 236 82 230 112 238 208Z" fill="#c7d2fe" opacity="0.26" />
            <path d="M242 106 236 82 232 110 238 200Z" fill="#e0e7ff" opacity="0.72" />
            <path d="M236 84 232 110" stroke="#ffffff" strokeWidth="1.4" opacity="0.8" />
            <rect x="232" y="196" width="20" height="5" rx="2.5" fill="#312e81" />
            <rect x="239" y="201" width="6" height="16" rx="3" fill="#151a33" />
          </g>
        </g>

        {/* High shadow-coat collar framing the jaw. */}
        <path
          d="M110 158c-8-28-5-52 10-70-1 25 4 46 18 60l-28 10Z"
          fill="#0a0d1b"
        />
        <path
          d="M210 158c8-28 5-52-10-70 1 25-4 46-18 60l28 10Z"
          fill="#0a0d1b"
        />

        {/* Neck */}
        <path d="M143 134h34v30c0 7-8 12-17 12s-17-5-17-12v-30Z" fill="url(#jin-skin-sh)" />
        <path d="M143 134h34v8c-11 5-23 5-34 0v-8Z" fill="#a97257" opacity="0.55" />

        {/* Ears */}
        <ellipse cx="104" cy="97" rx="7" ry="12" fill="#dfa886" />
        <ellipse cx="216" cy="97" rx="7" ry="12" fill="#dfa886" />

        {/* Back hair mass */}
        <path
          d="M102 106C89 58 117 18 160 18c43 0 71 40 58 88-5-17-13-31-24-41-15 15-37 22-61 19-14-2-26 4-31 22Z"
          fill="url(#jin-hair)"
        />
        <path
          d="M104 92c-3 20-1 38 6 54l-12-9c-6-16-6-32-1-48l7 3Z"
          fill="url(#jin-hair)"
        />
        <path
          d="M216 92c3 20 1 38-6 54l12-9c6-16 6-32 1-48l-7 3Z"
          fill="url(#jin-hair)"
        />

        {/* Face — angular jaw, sharp cheek plane */}
        <path
          d="M160 24c33 0 52 22 54 56 1 17-3 33-10 46-7 14-18 25-31 33l-13 7-13-7c-13-8-24-19-31-33-7-13-11-29-10-46 2-34 21-56 54-56Z"
          fill="url(#jin-skin)"
          stroke="#7a4a36"
          strokeOpacity="0.32"
          strokeWidth="1.1"
        />
        {/* Cel cheek shadow */}
        <path
          d="M199 62c10 20 9 44-3 62-8 12-20 21-34 25 18-4 32-14 40-28 9-17 10-38 3-57l-6-2Z"
          fill="#c08d74"
          opacity="0.4"
        />
        <path d="M120 118c7 14 18 24 31 29-15-2-27-11-35-24l4-5Z" fill="#c08d74" opacity="0.3" />
        <path d="M206 88c4 18 1 36-9 50 8-8 13-20 14-33l-5-17Z" fill="#a97257" opacity="0.28" />

        {/* Eyes — the focal point */}
        <g className="anime-eyes">
          <ellipse cx="134" cy="97" rx="13" ry="10" fill="#8b5cf6" opacity="0.3" filter="url(#jin-glow)" />
          <ellipse cx="186" cy="97" rx="13" ry="10" fill="#8b5cf6" opacity="0.3" filter="url(#jin-glow)" />
          <path d="M116 97c9-8 28-9 38-1-7 9-28 10-38 1Z" fill="#f8fafc" />
          <path d="M166 96c10-9 29-8 38 1-10 10-31 8-38-1Z" fill="#f8fafc" />
          <ellipse cx="134" cy="97" rx="6.2" ry="7.2" fill="url(#jin-iris)" />
          <ellipse cx="186" cy="97" rx="6.2" ry="7.2" fill="url(#jin-iris)" />
          <ellipse cx="134" cy="97.6" rx="2.8" ry="4" fill="#140d33" />
          <ellipse cx="186" cy="97.6" rx="2.8" ry="4" fill="#140d33" />
          <circle cx="131.8" cy="94.2" r="2" fill="#ffffff" />
          <circle cx="183.8" cy="94.2" r="2" fill="#ffffff" />
          <circle cx="137" cy="100" r="1.1" fill="#ddd6fe" opacity="0.9" />
          <circle cx="189" cy="100" r="1.1" fill="#ddd6fe" opacity="0.9" />
          <path
            d="M114 95c9-12 30-13 40-2"
            fill="none"
            stroke="#0a0a16"
            strokeWidth="3.6"
            strokeLinecap="round"
          />
          <path
            d="M166 93c10-12 31-11 40 2"
            fill="none"
            stroke="#0a0a16"
            strokeWidth="3.6"
            strokeLinecap="round"
          />
          <path d="M150 90l-3 6" stroke="#0a0a16" strokeWidth="2.4" strokeLinecap="round" />
          <path d="M202 89l3 6" stroke="#0a0a16" strokeWidth="2.4" strokeLinecap="round" />
        </g>

        {/* Brows, nose, mouth */}
        <path
          d="M112 80c11-7 28-7 38-1"
          fill="none"
          stroke="#141833"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <path
          d="M170 79c10-6 27-6 38 1"
          fill="none"
          stroke="#141833"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <path
          d="M161 108l-4 7h7"
          fill="none"
          stroke="#b1826b"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M151 128c6 1.5 12 1.5 18 0"
          fill="none"
          stroke="#7c3f5c"
          strokeWidth="2.2"
          strokeLinecap="round"
        />

        {/* Long bangs falling over the brow — the look from the manhwa. */}
        <path
          d="M124 42c-11 28-13 54-8 78 9-8 13-22 15-38l-7-40Z"
          fill="url(#jin-hair)"
        />
        <path
          d="M196 42c11 28 13 54 8 78-9-8-13-22-15-38l7-40Z"
          fill="url(#jin-hair)"
        />
        <path
          d="M150 32c-4 26-3 48 3 68l7-32-4-36h-6Z"
          fill="url(#jin-hair)"
        />
        <path
          d="M172 36c5 20 7 39 5 57l-8-27 3-30Z"
          fill="url(#jin-hair)"
        />

        {/* Front bangs — sharp layered spikes */}
        <path
          d="M104 98C99 55 124 22 160 22c38 0 62 31 57 74l-8-16-3 20-10-22-6 22-10-24-8 22-10-22-7 20-8-18-6 17-8-16-4 21-8-19-4 16Z"
          fill="url(#jin-hair)"
        />
        <path
          d="M123 44c14-12 35-17 54-9"
          fill="none"
          stroke="#586499"
          strokeWidth="2.6"
          strokeLinecap="round"
          opacity="0.7"
        />
        <path
          d="M141 60c11-7 25-9 38-5"
          fill="none"
          stroke="#586499"
          strokeWidth="2"
          strokeLinecap="round"
          opacity="0.5"
        />
        {/* Jagged crown silhouette above the fringe */}
        <path
          d="M116 54l-14-26 24 10-1-22 19 16 8-22 15 20 15-19 6 22 19-11-7 24 19-4-14 20-88-8Z"
          fill="url(#jin-hair)"
        />

        {/* Mana flame above the raised shoulder */}
        <g className="anime-aura" opacity="0.9">
          <path
            d="M252 150l10-27 3 15 11-6-14 30-2-10-8 2Z"
            fill="#a5b4fc"
          />
          <circle cx="258" cy="166" r="2" fill="#c7d2fe" />
          <circle cx="266" cy="158" r="1.4" fill="#818cf8" />
        </g>

        {/* Shadows pooling at the hem — the monarch's army in miniature. */}
        <g opacity="0.5" fill="#4338ca">
          <path d="M18 208c18-9 35-7 47 2-14-1-27 2-37 9l-10-11Z" />
          <path d="M302 208c-18-9-35-7-47 2 14-1 27 2 37 9l10-11Z" />
          <path d="M38 200c7-4 14-3 19 1-6 0-11 1-15 4l-4-5Z" opacity="0.7" />
        </g>
      </g>

      {/* Mana motes */}
      <g fill="#c4b5fd">
        <circle cx="92" cy="66" r="2.2" opacity="0.75" />
        <circle cx="120" cy="38" r="1.5" opacity="0.5" />
        <circle cx="292" cy="108" r="1.8" opacity="0.6" />
        <circle cx="44" cy="142" r="1.4" opacity="0.45" />
      </g>
    </svg>
  );
}

function CrimsonKnight({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <svg
      viewBox="0 0 320 240"
      role="img"
      aria-label="Original anime-style crimson knight portrait with a horned helm and glowing visor"
      className={className}
      style={style}
    >
      <defs>
        <radialGradient id="igris-aura" cx="0.5" cy="0.45" r="0.55">
          <stop offset="0" stopColor="#fecaca" />
          <stop offset="0.35" stopColor="#dc2626" />
          <stop offset="0.72" stopColor="#450a0a" />
          <stop offset="1" stopColor="#080505" />
        </radialGradient>
        <linearGradient id="igris-plate" x1="0.1" y1="0" x2="0.8" y2="1">
          <stop offset="0" stopColor="#7a1c1c" />
          <stop offset="0.35" stopColor="#33100f" />
          <stop offset="0.7" stopColor="#4d1616" />
          <stop offset="1" stopColor="#100505" />
        </linearGradient>
        <linearGradient id="igris-plate-hi" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f87171" />
          <stop offset="0.5" stopColor="#b91c1c" />
          <stop offset="1" stopColor="#5c1414" />
        </linearGradient>
        <linearGradient id="igris-plume" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fca5a5" />
          <stop offset="0.45" stopColor="#dc2626" />
          <stop offset="1" stopColor="#7f1d1d" />
        </linearGradient>
        <linearGradient id="igris-blade" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fee2e2" />
          <stop offset="0.35" stopColor="#fca5a5" />
          <stop offset="0.7" stopColor="#ef4444" />
          <stop offset="1" stopColor="#7f1d1d" />
        </linearGradient>
        <filter id="igris-glow" x="-90%" y="-90%" width="280%" height="280%">
          <feDropShadow dx="0" dy="0" stdDeviation="6" floodColor="#ef4444" floodOpacity="0.95" />
        </filter>
        <filter id="igris-soft" x="-40%" y="-40%" width="180%" height="180%">
          <feDropShadow dx="0" dy="8" stdDeviation="7" floodColor="#000000" floodOpacity="0.72" />
        </filter>
      </defs>

      {/* Command aura */}
      <circle
        className="anime-aura"
        cx="252"
        cy="58"
        r="48"
        fill="url(#igris-aura)"
        opacity="0.32"
      />
      <circle cx="252" cy="58" r="32" fill="none" stroke="#fca5a5" strokeWidth="1.4" opacity="0.5" />
      <circle cx="252" cy="58" r="21" fill="none" stroke="#fecaca" strokeWidth="1" opacity="0.32" />

      {/* Ashen ground */}
      <path
        d="M4 214c40-21 74-15 104 0 29-13 60-12 88 1 28-10 57-9 82 3 16-5 33-4 48 3H4Z"
        fill="#7f1d1d"
        opacity="0.26"
      />

      <g filter="url(#igris-soft)">
        {/* Plume streaming behind the helm */}
        <path
          className="anime-cloak"
          d="M168 30c24-11 51-6 63 10 12 17 4 36-10 46-9 7-20 8-27 2 12-3 20-11 21-21 1-13-10-23-25-24l-22-13Z"
          fill="url(#igris-plume)"
        />
        <path
          d="M218 38c14 4 24 14 24 26-1 11-9 20-20 24 8-6 13-14 13-23 0-10-7-19-17-27Z"
          fill="#fecaca"
          opacity="0.45"
        />
        {/* Second feather layer gives the plume its swept, wind-torn mass. */}
        <path
          d="M176 34c18-8 38-4 47 8 8 13 1 26-9 33 6-9 4-19-4-25-9-7-22-8-34-16Z"
          fill="url(#igris-plume)"
          opacity="0.75"
        />

        {/* Greatsword over the shoulder */}
        <g className="anime-blade" transform="rotate(16 254 150)">
          <rect x="247" y="60" width="10" height="128" rx="4" fill="url(#igris-blade)" />
          <path d="M247 60h10l-5-22-5 22Z" fill="#fee2e2" />
          <rect x="238" y="184" width="28" height="7" rx="3.5" fill="#450a0a" />
          <rect x="249" y="191" width="6" height="20" rx="3" fill="#1c0a0a" />
          <path d="M251 68h2v108h-2Z" fill="#fff5f5" opacity="0.75" />
        </g>

        {/* Cape / shoulders */}
        <path
          d="M160 164c30 0 58 8 81 23 24 16 38 38 40 53H35c2-15 16-37 40-53 23-15 51-23 81-23Z"
          fill="url(#igris-plate)"
        />
        <path d="M160 168c14 0 28 2 40 6l-40 70-40-70c12-4 26-6 40-6Z" fill="#150606" opacity="0.9" />
        <path d="M160 198l8 10-8 24-8-24 8-10Z" fill="url(#igris-plate-hi)" opacity="0.8" />

        {/* Layered pauldrons */}
        <path d="M100 174c-20 7-34 25-39 49l-3 17h37l5-34 14-29-14-3Z" fill="#2a0d0d" />
        <path d="M220 174c20 7 34 25 39 49l3 17h-37l-5-34-14-29 14-3Z" fill="#2a0d0d" />
        <path d="M98 179l-28 16 23 7 18-14-13-9Z" fill="url(#igris-plate-hi)" opacity="0.85" />
        <path d="M222 179l28 16-23 7-18-14 13-9Z" fill="url(#igris-plate-hi)" opacity="0.85" />
        <path d="M86 205l18-2 4 8-18 3-4-9Z" fill="#fca5a5" opacity="0.55" />
        <path d="M234 205l-18-2-4 8 18 3 4-9Z" fill="#fca5a5" opacity="0.55" />
        {/* Pauldron spikes */}
        <path d="M91 172l-16-14 2 18 14 6v-10Z" fill="url(#igris-plate-hi)" />
        <path d="M229 172l16-14-2 18-14 6v-10Z" fill="url(#igris-plate-hi)" />

        {/* Gorget */}
        <path d="M136 144c8 5 16 8 24 8s16-3 24-8l7 20c-10 7-20 10-31 10s-21-3-31-10l7-20Z" fill="#3d1010" />
        <path d="M142 150c6 3 12 5 18 5s12-2 18-5" fill="none" stroke="#ef4444" strokeWidth="1.6" opacity="0.6" />

        {/* Helm */}
        <path
          d="M160 28c25 0 45 18 49 45l4 32c-12 18-31 28-53 28s-41-10-53-28l4-32c4-27 24-45 49-45Z"
          fill="url(#igris-plate)"
        />
        {/* Cel highlight on the dome */}
        <path
          d="M160 34c18 0 33 10 41 26-8-8-20-13-33-13-9 0-17 2-24 6-6 3-12 7-16 12 8-18 19-31 32-31Z"
          fill="#f87171"
          opacity="0.4"
        />
        {/* Center ridge */}
        <path d="M158 34h4l2 26-4 8-4-8 2-26Z" fill="url(#igris-plate-hi)" opacity="0.75" />
        {/* Rim light along the left edge of the helm */}
        <path
          d="M119 74c-2 12-2 24-1 35 2 12 7 22 15 30-11-5-19-15-23-28-3-12-2-25 2-38l7 1Z"
          fill="#fca5a5"
          opacity="0.35"
        />

        {/* Horns — swept back rather than wide, with a bright cutting edge. */}
        <path d="M126 60C113 43 98 34 84 38c10 8 17 19 20 32l22-10Z" fill="#5c1414" />
        <path d="M194 60c13-17 28-26 42-22-10 8-17 19-20 32l-22-10Z" fill="#5c1414" />
        <path d="M126 60C113 43 98 34 84 38c9 7 15 16 18 27l24-5Z" fill="url(#igris-plate-hi)" opacity="0.8" />
        <path d="M194 60c13-17 28-26 42-22-9 7-15 16-18 27l-24-5Z" fill="url(#igris-plate-hi)" opacity="0.8" />
        <path d="M88 42c8 6 14 14 17 24" fill="none" stroke="#fecaca" strokeWidth="1.4" opacity="0.55" />
        <path d="M232 42c-8 6-14 14-17 24" fill="none" stroke="#fecaca" strokeWidth="1.4" opacity="0.55" />

        {/* Faceplate */}
        <path
          d="M121 92c12-5 25-8 39-8s27 3 39 8l-6 22c-4 15-17 24-33 24s-29-9-33-24l-6-22Z"
          fill="#120606"
        />
        {/* Visor — two fierce crimson eye slits, not a letterbox bar. */}
        <g filter="url(#igris-glow)">
          <path d="M129 98l28 5-3 10-25-4V98Z" fill="#ef4444" />
          <path d="M191 98l-28 5 3 10 25-4V98Z" fill="#ef4444" />
          <path d="M134 101l22 4-2 4-20-3v-5Z" fill="#fff5f5" opacity="0.92" />
          <path d="M186 101l-22 4 2 4 20-3v-5Z" fill="#fff5f5" opacity="0.92" />
        </g>
        {/* Breathing slits */}
        <path d="M146 116v11M160 116v13M174 116v11" stroke="#7f1d1d" strokeWidth="2" strokeLinecap="round" opacity="0.85" />
        <path d="M139 132c7 3 14 5 21 5s14-2 21-5" fill="none" stroke="#450a0a" strokeWidth="2" strokeLinecap="round" />
      </g>

      {/* Embers */}
      <g fill="#f87171">
        <circle cx="86" cy="78" r="2.3" opacity="0.8" />
        <circle cx="110" cy="46" r="1.5" opacity="0.55" />
        <circle cx="290" cy="116" r="2" opacity="0.65" />
        <circle cx="44" cy="150" r="1.4" opacity="0.45" />
        <circle cx="274" cy="170" r="1.7" opacity="0.5" />
      </g>
      <path d="M76 112l8-23 2 14 10-6-12 25-1-11-7 1Z" fill="#fca5a5" opacity="0.55" />
    </svg>
  );
}
