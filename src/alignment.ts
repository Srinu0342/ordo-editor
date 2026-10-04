// Alignment guides: the pure part of "snap to other nodes while dragging".
//
// Nothing here touches React Flow. It takes the moving box and the boxes it
// could line up with, all in absolute canvas coordinates, and says how far to
// nudge the box and which guide lines to draw. The drag pipeline in App applies
// the nudge; the overlay draws the lines.

import type { Rect } from "./types.ts";

type Axis = "x" | "y";

// A line to draw: at `at` on `axis`, running `from` → `to` across it.
export type Guide = { axis: Axis; at: number; from: number; to: number };

// Reach of the pull, in SCREEN pixels. Divided by the zoom before use, so the
// pull feels the same whether you are zoomed in on a detail or out on a map.
export const GUIDE_SNAP_PX = 6;

// Anything closer than this counts as aligned when deciding which lines to
// draw. Well under the snap reach, so a guide only ever shows an alignment the
// snap actually produced.
const EPS = 0.5;

// Left/centre/right (or top/middle/bottom) — the three lines a box offers.
const anchors = (r: Rect, axis: Axis) =>
  axis === "x"
    ? [r.x, r.x + r.width / 2, r.x + r.width]
    : [r.y, r.y + r.height / 2, r.y + r.height];

// The cross-axis extent of a box: a vertical guide spans boxes top to bottom.
const span = (r: Rect, axis: Axis) =>
  axis === "x" ? [r.y, r.y + r.height] : [r.x, r.x + r.width];

// Smallest correction that brings one of `rect`'s anchors onto one of the
// others', or 0 when nothing is within reach.
const snapAxis = (
  rect: Rect,
  others: Rect[],
  axis: Axis,
  threshold: number,
) => {
  const mine = anchors(rect, axis);
  let best: number | null = null;

  for (const o of others) {
    for (const theirs of anchors(o, axis)) {
      for (const m of mine) {
        const d = theirs - m;
        if (Math.abs(d) > threshold) continue;
        if (best === null || Math.abs(d) < Math.abs(best)) best = d;
      }
    }
  }
  return best ?? 0;
};

// Every line the snapped box now shares with another, each drawn from the far
// end of one box to the far end of the other so it reads as "these two".
const guidesFor = (rect: Rect, others: Rect[], axis: Axis) => {
  const lines = new Map<number, Guide>();

  for (const at of anchors(rect, axis)) {
    for (const o of others) {
      if (!anchors(o, axis).some((v) => Math.abs(v - at) < EPS)) continue;

      const [a0, a1] = span(rect, axis);
      const [b0, b1] = span(o, axis);
      const key = Math.round(at * 2) / 2;
      const prev = lines.get(key);
      lines.set(key, {
        axis,
        at,
        from: Math.min(a0, b0, prev?.from ?? Infinity),
        to: Math.max(a1, b1, prev?.to ?? -Infinity),
      });
    }
  }
  return [...lines.values()];
};

// `rect` is the moving box (a multi-selection moves as its union, so it lines
// up as one thing). Returns the nudge and the guides to draw once it is
// applied. Axes are independent: a box can snap across and float down.
export function alignRect(rect: Rect, others: Rect[], threshold: number) {
  const dx = snapAxis(rect, others, "x", threshold);
  const dy = snapAxis(rect, others, "y", threshold);
  const snapped = { ...rect, x: rect.x + dx, y: rect.y + dy };

  return {
    dx,
    dy,
    guides: [
      ...guidesFor(snapped, others, "x"),
      ...guidesFor(snapped, others, "y"),
    ],
  };
}
