import { Copyable } from "./Copyable.tsx";

/** The single truncation marker every crop arm uses — matches
 *  `studio/src/lib/page-title.ts:53-56`'s convention (one `…`, U+2026, never
 *  three periods). */
const MARKER = "…";

/**
 * Truncate `value` on a character budget, keeping `chars` VALUE characters and
 * adding {@link MARKER} on top (the marker is extra, not counted against
 * `chars`) — mirrors `page-title.ts`'s `clamp()` in STYLE (a single budget,
 * slice + marker, pure) but NOT its arithmetic: `clamp` slices at
 * `MAX - 1` so its marker counts inside the budget, which is the wrong shape
 * here (see `CopyableText.test.ts`'s fixture table).
 *
 * `chars` omitted, less than 1, or covering the whole value: returned as-is,
 * no marker.
 */
export function cropText(
  value: string,
  chars?: number,
  crop: "start" | "end" | "middle" = "end",
): string {
  if (chars === undefined || chars < 1 || chars >= value.length) return value;

  if (crop === "start") {
    return `${MARKER}${value.slice(value.length - chars)}`;
  }
  if (crop === "end") {
    return `${value.slice(0, chars)}${MARKER}`;
  }

  // middle
  const head = Math.ceil(chars / 2);
  const tail = chars - head;
  return `${value.slice(0, head)}${MARKER}${value.slice(value.length - tail)}`;
}

export interface CopyableTextProps {
  /** The full string. Always what gets written to the clipboard, regardless
   *  of how much of it the cropped display shows. */
  value: string;
  /** How many VALUE characters to show. Omitted, `< 1`, or `>= value.length`
   *  ⇒ shown in full. */
  chars?: number;
  /** Where the marker goes. Default `"end"`. */
  crop?: "start" | "end" | "middle";
  /** Accessible name of the copy button. Default "Copy" (per `Copyable`). */
  label?: string;
  className?: string;
  /** Forwarded to `Copyable`. See its own doc for the revert-delay caveat. */
  copiedMs?: number;
}

/**
 * A chrome-less, croppable copy-to-clipboard text — for a value too long to
 * show in full inline (an id, a token, a URL fragment) that still needs to be
 * copyable exactly.
 *
 * Composes `Copyable` rather than widening it (`Copyable`'s box chrome has 9
 * existing call sites depending on it) — `readOnly` + the
 * `.w6w-copyable--bare` modifier (`_copyable.scss`) strip the box, and the
 * FULL `value` is what `Copyable` receives, so a click always copies the
 * whole string even when the display is cropped. No `navigator.clipboard`
 * call lives in this file — that stays `Copyable`'s alone.
 */
export function CopyableText(props: CopyableTextProps) {
  const { value, chars, crop = "end", label, className, copiedMs } = props;
  const cropped = cropText(value, chars, crop);
  const classes = ["w6w-copyable--bare", className].filter(Boolean).join(" ");

  return (
    <Copyable value={value} readOnly label={label} className={classes} copiedMs={copiedMs}>
      <span>{cropped}</span>
    </Copyable>
  );
}
