import { useId } from "react";

/**
 * The Links brand glyph, inline and colored with its signature gradient.
 * Used anywhere two linked tracks need a visual connector instead of a
 * plain arrow or dash — the album art chain and the track-name line.
 *
 * Uses useId() for the gradient's id so multiple instances on the same
 * page never collide (a plain hardcoded id would cause rendering bugs
 * once more than one inline SVG on the page shares the same <defs> id).
 */
export default function LinkGlyph({ size = 14 }: { size?: number }) {
  const gradientId = useId();

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 1272 1272"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ flexShrink: 0 }}
      aria-hidden="true"
    >
      <path
        d="M729.983 541.421C860.156 671.594 860.156 882.652 729.983 1012.83L635.702 1107.11C505.527 1237.28 294.471 1237.28 164.297 1107.11C34.1229 976.932 34.1229 765.876 164.297 635.702L187.868 612.132M541.421 729.983C411.246 599.808 411.247 388.752 541.421 258.578L635.702 164.297C765.876 34.1236 976.932 34.1227 1107.11 164.297C1237.28 294.471 1237.28 505.528 1107.11 635.702L1083.54 659.272"
        stroke={`url(#${gradientId})`}
        strokeWidth="133.333"
        strokeLinecap="round"
      />
      <defs>
        <linearGradient
          id={gradientId}
          x1="400"
          y1="400"
          x2="871.404"
          y2="871.404"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#1ED760" />
          <stop offset="1" stopColor="#26B258" />
        </linearGradient>
      </defs>
    </svg>
  );
}
