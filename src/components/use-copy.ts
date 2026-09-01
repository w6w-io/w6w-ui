import { useCallback, useEffect, useRef, useState } from "react";

/** Majority precedent across the tree: `admin/src/components/CopyButton.tsx:17`,
 *  `studio/src/pages/EndpointsPage.tsx:823`. */
export const COPIED_MS = 1500;

/**
 * The clipboard-write + copied/revert-timer state machine, factored out of
 * `Copyable` so `JsonEditor` can drive its own in-box button without a second
 * clipboard call site. This is the ONLY spot in `@w6w/ui`'s `src` that writes
 * to the clipboard — `Copyable` and `JsonEditor` both consume it rather than
 * each writing their own.
 */
export function useCopyToClipboard(value: string, copiedMs: number = COPIED_MS) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear the revert timer on unmount so it never fires setState after the
  // component is gone.
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, []);

  const copy = useCallback(async () => {
    try {
      // The only clipboard-write call site in `@w6w/ui` (gated by the
      // project's test plan). Guarded + awaited: an absent (insecure origin)
      // or rejecting clipboard leaves the idle icon and throws nothing further.
      await navigator.clipboard?.writeText(value);
      setCopied(true);
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), copiedMs);
    } catch {
      // Absent/denied/rejecting clipboard: stay idle.
    }
  }, [value, copiedMs]);

  return { copied, copy };
}
