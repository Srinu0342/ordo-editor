import { useCallback, useEffect, useState } from "react";

export type Scheme = "light" | "dark";

// The scheme picked with the toolbar toggle. Until one is picked the editor
// follows the system setting, live. index.html reads the same key before first
// paint, so a reload never flashes the other scheme.
export const SCHEME_KEY = "ordo.colorScheme";

const systemQuery = () => window.matchMedia("(prefers-color-scheme: dark)");

// Storage can throw (private mode, blocked site data); a lost choice just
// means following the system again.
const saved = (): Scheme | null => {
  try {
    const v = localStorage.getItem(SCHEME_KEY);
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null;
  }
};

export function useColorScheme() {
  const [choice, setChoice] = useState<Scheme | null>(saved);
  const [system, setSystem] = useState<Scheme>(() =>
    systemQuery().matches ? "dark" : "light",
  );

  useEffect(() => {
    const mq = systemQuery();
    const onChange = () => setSystem(mq.matches ? "dark" : "light");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const scheme = choice ?? system;

  // The chrome's custom properties (ui.css) key off this attribute.
  useEffect(() => {
    document.documentElement.dataset.theme = scheme;
  }, [scheme]);

  const toggle = useCallback(() => {
    const next: Scheme = scheme === "dark" ? "light" : "dark";
    setChoice(next);
    try {
      localStorage.setItem(SCHEME_KEY, next);
    } catch {
      // kept for this session only
    }
  }, [scheme]);

  return [scheme, toggle] as const;
}
