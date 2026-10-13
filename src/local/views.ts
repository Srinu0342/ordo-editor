// Per-browser memory of where each diagram was last looked at: the zoom and
// pan its tab was left on, so opening it again lands there. A diagram with
// nothing remembered is fitted, as before. Like recent.ts, a convenience and
// nothing more: storage can be blocked, full, or missing, and every read and
// write is wrapped so the canvas works the same without it.

import type { Viewport } from "@xyflow/react";

const VIEWS_KEY = "ordo.views";
// Kept in the order last touched; the oldest go past this, so tabs long gone
// or never reopened don't pile up for ever.
export const VIEWS_LIMIT = 200;

type Views = Record<string, Viewport>;

// A repo path and a tab name can each hold almost anything; as a JSON pair
// they can never run together into someone else's key.
const keyOf = (repo: string, tab: string) => JSON.stringify([repo, tab]);

const isView = (v: unknown): v is Viewport => {
  const { x, y, zoom } = (v ?? {}) as Partial<Viewport>;
  return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(zoom) && zoom! > 0;
};

function load(): Views {
  try {
    const all: unknown = JSON.parse(globalThis.localStorage?.getItem(VIEWS_KEY) ?? "{}");
    return all && typeof all === "object" && !Array.isArray(all) ? (all as Views) : {};
  } catch {
    return {};
  }
}

function save(views: Views) {
  const keys = Object.keys(views);
  for (const k of keys.slice(0, Math.max(0, keys.length - VIEWS_LIMIT))) delete views[k];
  try {
    globalThis.localStorage?.setItem(VIEWS_KEY, JSON.stringify(views));
  } catch {
    // nothing to do: the tab simply opens fitted next time
  }
}

/** Where diagram `tab` of `repo` was last left, or null to fit it. */
export function savedView(repo: string, tab: string): Viewport | null {
  const view = load()[keyOf(repo, tab)];
  return isView(view) ? { x: view.x, y: view.y, zoom: view.zoom } : null;
}

export function rememberView(repo: string, tab: string, view: Viewport) {
  if (!isView(view)) return;
  const views = load();
  const key = keyOf(repo, tab);
  delete views[key]; // re-added last: the newest stays clear of the limit
  views[key] = { x: view.x, y: view.y, zoom: view.zoom };
  save(views);
}

/** A renamed diagram keeps its view. */
export function moveView(repo: string, from: string, to: string) {
  const views = load();
  const view = views[keyOf(repo, from)];
  if (!view) return;
  delete views[keyOf(repo, from)];
  delete views[keyOf(repo, to)];
  views[keyOf(repo, to)] = view;
  save(views);
}

/** A diagram that is gone takes its view with it, so a new one by that name opens fitted. */
export function forgetView(repo: string, tab: string) {
  const views = load();
  if (!(keyOf(repo, tab) in views)) return;
  delete views[keyOf(repo, tab)];
  save(views);
}
