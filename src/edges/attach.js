// Riding an edge.
//
// A node attached to an edge stores a fraction along it (`t`), never a point:
// the point is re-derived from the edge's live geometry every time something
// moves, so the rider follows a reroute, a resize and a dragged endpoint
// without knowing any of those happened.
//
// The geometry comes from the <path> React Flow just drew rather than from a
// re-run of the router. That is deliberate — it means a rider works on every
// route in ROUTES, and on any route added later, with no per-router maths here.
// Path coordinates are flow coordinates (the viewport transform sits on an
// ancestor <g>), so nothing has to be converted.

// How close the pointer has to be to an edge for a drop to stick, and how far
// you have to pull before a rider lets go. The gap between them is hysteresis:
// without it a rider sitting exactly on its edge would flicker between states.
export const SNAP_DIST = 28;
export const DETACH_DIST = 46;

const clamp01 = (v) => Math.min(1, Math.max(0, v));

export const edgePathEl = (edgeId) =>
  document.querySelector(
    `.react-flow__edge[data-id="${CSS.escape(String(edgeId))}"] path.react-flow__edge-path`,
  );

const lengthOf = (el) => {
  try {
    return el?.getTotalLength?.() ?? 0;
  } catch {
    return 0; // a path mid-remount can throw rather than measure
  }
};

/** Point and tangent at fraction `t`, in flow coordinates. */
export function pointAt(el, t) {
  const total = lengthOf(el);
  if (!total) return null;

  const at = clamp01(t) * total;
  const p = el.getPointAtLength(at);
  // A short chord either side gives the tangent without needing derivatives,
  // and degrades to the end tangent at t = 0 or 1 because both samples clamp.
  const step = Math.min(2, total / 2) || 1;
  const a = el.getPointAtLength(Math.max(0, at - step));
  const b = el.getPointAtLength(Math.min(total, at + step));

  return {
    x: p.x,
    y: p.y,
    angle: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI,
  };
}

/**
 * Closest point on `el` to `point`: a coarse sweep, then two narrowing passes
 * around the winner. Sub-pixel on any length of path for ~50 samples, and
 * immune to the local minima a pure binary search falls into on an S-curve.
 */
export function nearestOnPath(el, point) {
  const total = lengthOf(el);
  if (!total) return null;

  let lo = 0;
  let hi = 1;
  let steps = Math.min(96, Math.max(16, Math.round(total / 8)));
  let best = null;

  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i <= steps; i++) {
      const t = lo + ((hi - lo) * i) / steps;
      const p = el.getPointAtLength(t * total);
      const d = (p.x - point.x) ** 2 + (p.y - point.y) ** 2;
      if (!best || d < best.d) best = { t, d, x: p.x, y: p.y };
    }
    const span = (hi - lo) / steps;
    lo = Math.max(0, best.t - span);
    hi = Math.min(1, best.t + span);
    steps = 8;
  }

  return { t: best.t, x: best.x, y: best.y, dist: Math.sqrt(best.d) };
}

/**
 * The edge `point` would attach to, or null. `skipIds` keeps a rider off the
 * edges it is itself an endpoint of — those move WITH it, and an edge chasing
 * the node that is chasing it never settles.
 */
export function nearestEdge(edges, point, maxDist = SNAP_DIST, skipIds) {
  let best = null;

  for (const edge of edges) {
    if (skipIds?.has(edge.id)) continue;

    const el = edgePathEl(edge.id);
    if (!el) continue;

    const hit = nearestOnPath(el, point);
    if (!hit || hit.dist > maxDist) continue;
    if (!best || hit.dist < best.dist) best = { edgeId: edge.id, el, ...hit };
  }

  // The tangent is only wanted for the winner, so it is taken here rather than
  // on every candidate.
  if (best) best.angle = pointAt(best.el, best.t)?.angle ?? 0;
  return best;
}

/** Edges that would move if `nodeIds` moved. */
export const edgesTouching = (edges, nodeIds) =>
  new Set(
    edges
      .filter((e) => nodeIds.has(e.source) || nodeIds.has(e.target))
      .map((e) => e.id),
  );
