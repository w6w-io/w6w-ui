import { useState } from "react";
import { useEffectiveTheme } from "../theme.ts";
import type { ThemeMode } from "../types.ts";

interface Props {
  /** Data URI or absolute URL for the light-mode icon. Falsy → render an initials tile. */
  src?: string;
  /** Optional dark-mode variant; used when `theme === "dark"`. */
  srcDark?: string;
  /** Background color when falling back to the initials tile. */
  brandColor?: string;
  /** Display name used to produce initials when there's no image. */
  name?: string;
  /** Square px size. Defaults to 32. */
  size?: number;
  /**
   * Explicit theme. If omitted, reads `data-theme` from `<html>` and falls
   * back to `prefers-color-scheme` — matches how most theme systems work.
   */
  theme?: ThemeMode;
}

/**
 * Renders an app's icon. Prefers the inlined SVG served by the w6w server;
 * falls back to a small initials tile when no icon is provided or when both
 * light and dark variants are missing.
 */
export function AppIcon({ src, srcDark, brandColor, name, size = 32, theme }: Props) {
  const effective = useEffectiveTheme(theme);
  const displaySrc = effective === "dark" ? (srcDark ?? src) : src;
  // An icon ref that failed to inline server-side (asset-inliner.ts) can persist
  // as a raw, unresolvable path string rather than a data: URI — that never
  // renders, so `<img>` needs an escape hatch to the initials tile too. Stores
  // the src it failed on (not just a bool) so a later, different src retries
  // instead of staying stuck on the fallback.
  const [brokenSrc, setBrokenSrc] = useState<string | undefined>(undefined);

  if (displaySrc && displaySrc !== brokenSrc) {
    return (
      <img
        src={displaySrc}
        width={size}
        height={size}
        alt=""
        onError={() => setBrokenSrc(displaySrc)}
        style={{
          width: size,
          height: size,
          borderRadius: 6,
          flexShrink: 0,
          // `contain` (not `cover`) keeps the whole glyph visible; the small
          // inset + border-box keep square/edge-to-edge icons from clipping
          // the rounded frame, without eating so much of the box that the
          // glyph reads as a stamp inside a swatch.
          objectFit: "contain",
          padding: Math.max(1, Math.round(size * 0.06)),
          boxSizing: "border-box",
          // A real icon SVG carries its own colors — painting `brandColor`
          // behind it double-tints the glyph and, for icons with built-in
          // transparent margin, reads as a thick brand-colored border rather
          // than an icon. Always the neutral swatch here; `brandColor` stays
          // reserved for the initials-tile fallback below, where it IS the
          // glyph's only color.
          background: "var(--w6w-icon-swatch, var(--w6w-panel-2))",
        }}
      />
    );
  }

  const initials = (name ?? "?")
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: 6,
        background: brandColor ?? "var(--w6w-accent)",
        color: "#fff",
        fontWeight: 700,
        fontSize: Math.round(size * 0.42),
        flexShrink: 0,
      }}
    >
      {initials}
    </span>
  );
}
