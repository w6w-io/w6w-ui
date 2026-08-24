import { createContext, useContext, useEffect, useState } from "react";
import type { ThemeMode } from "./types.ts";

/**
 * Set by `<W6WUIProvider theme={...}>` (`provider.tsx`) — the HOST's
 * explicit theme choice for an EMBEDDED `@w6w/ui`, threaded through context
 * so every JS-side theme-aware component resolves the SAME value the
 * provider's own `data-theme` DOM wrapper sets for the CSS side (below),
 * without each component separately re-deriving it from `<html>`.
 * `undefined` when no `<W6WUIProvider>` is in the tree, or one that didn't
 * pass `theme` — every consumer then falls through to the pre-existing
 * `data-theme`-on-`<html>` / OS-preference chain unchanged. See
 * `docs/theming.md`.
 */
export const ProvidedThemeCtx = createContext<ThemeMode | undefined>(undefined);

/**
 * Resolve the effective light/dark mode. Priority: explicit prop >
 * `<W6WUIProvider theme>` > `data-theme` on <html> > `prefers-color-scheme`.
 * The `data-theme` step matches the CSS defaults in `styles.css`, so
 * components and stylesheet agree even without a provider `theme` — see
 * `docs/theming.md` for why relying on that alone is a trap for an embedded
 * host, though.
 */
export function detectTheme(explicit: ThemeMode | undefined, provided?: ThemeMode): ThemeMode {
  if (explicit) return explicit;
  if (provided) return provided;
  if (typeof document === "undefined") return "light";
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "dark" || attr === "light") return attr;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/**
 * Reactive `detectTheme`: reads `<W6WUIProvider theme>` from context, and —
 * when that's unset — subscribes to `data-theme` mutations on <html> and OS
 * `prefers-color-scheme` changes, so a runtime theme toggle (e.g. studio's
 * ThemeToggle, or a host re-rendering `<W6WUIProvider theme>` with a new
 * value) is reflected without a remount. Shared by every ui component that
 * needs the mode in JS (AppIcon, CodeEditor, JsonEditor, WorkflowFlowEditor)
 * so they never drift from each other or from the CSS.
 */
export function useEffectiveTheme(explicit?: ThemeMode): ThemeMode {
  const provided = useContext(ProvidedThemeCtx);
  const [mode, setMode] = useState<ThemeMode>(() => detectTheme(explicit, provided));

  useEffect(() => {
    if (explicit) {
      setMode(explicit);
      return;
    }
    if (provided) {
      setMode(provided);
      return;
    }
    if (typeof window === "undefined") return;

    const update = () => setMode(detectTheme(undefined, provided));

    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    mql.addEventListener("change", update);

    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    // Re-sync once in case the attribute changed between the initial render and
    // this effect running.
    update();

    return () => {
      mql.removeEventListener("change", update);
      observer.disconnect();
    };
  }, [explicit, provided]);

  return mode;
}
