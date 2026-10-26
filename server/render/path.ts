// An edge's path as points, for what the canvas asks the DOM: how long it is
// and where a fraction of the way along it lands (getTotalLength and
// getPointAtLength in edges/attach.ts), so a tube can ride its lifeline here
// too. Reads the absolute M, L, H, V, Q, C and Z the edge routers write.

export type Pt = { x: number; y: number };

// Points per curve: a bend in a step route is a short quadratic, and a curved
// route one cubic, so this is well under a pixel off on either.
const STEPS = 24;

export function polyline(d: string): Pt[] {
  const tokens = d.match(/[MLHVQCZ]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? [];
  const pts: Pt[] = [];
  let i = 0;
  let cmd = "";
  let at: Pt = { x: 0, y: 0 };
  let start: Pt = at;
  const num = () => Number(tokens[i++]);

  while (i < tokens.length) {
    if (/[A-Z]/i.test(tokens[i])) cmd = tokens[i++].toUpperCase();
    switch (cmd) {
      case "M":
        at = start = { x: num(), y: num() };
        pts.push(at);
        cmd = "L"; // pairs after an M are lines
        break;
      case "L":
        at = { x: num(), y: num() };
        pts.push(at);
        break;
      case "H":
        at = { x: num(), y: at.y };
        pts.push(at);
        break;
      case "V":
        at = { x: at.x, y: num() };
        pts.push(at);
        break;
      case "Q": {
        const c = { x: num(), y: num() };
        const to = { x: num(), y: num() };
        const from = at;
        for (let s = 1; s <= STEPS; s++) {
          const t = s / STEPS;
          const u = 1 - t;
          pts.push({
            x: u * u * from.x + 2 * u * t * c.x + t * t * to.x,
            y: u * u * from.y + 2 * u * t * c.y + t * t * to.y,
          });
        }
        at = to;
        break;
      }
      case "C": {
        const c1 = { x: num(), y: num() };
        const c2 = { x: num(), y: num() };
        const to = { x: num(), y: num() };
        const from = at;
        for (let s = 1; s <= STEPS; s++) {
          const t = s / STEPS;
          const u = 1 - t;
          pts.push({
            x: u * u * u * from.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * to.x,
            y: u * u * u * from.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * to.y,
          });
        }
        at = to;
        break;
      }
      case "Z":
        at = start;
        pts.push(at);
        break;
      default:
        i++; // a number with no command before it: skip it
    }
  }
  return pts;
}

const dist = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y);

/** The point `len` px along the line through `pts`, clamped to its ends. */
function pointAtLength(pts: Pt[], len: number): Pt {
  let left = Math.max(0, len);
  for (let i = 1; i < pts.length; i++) {
    const seg = dist(pts[i - 1], pts[i]);
    if (left <= seg && seg > 0) {
      const f = left / seg;
      return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * f, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * f };
    }
    left -= seg;
  }
  return pts[pts.length - 1];
}

export const lengthOf = (pts: Pt[]) => pts.reduce((sum, p, i) => (i ? sum + dist(pts[i - 1], p) : 0), 0);

/**
 * Point and tangent at fraction `t` of the way along, as attach.ts's pointAt
 * works them out on the canvas: the tangent from a chord 2 px either side.
 */
export function pointAt(pts: Pt[], t: number): { x: number; y: number; angle: number } | null {
  const total = lengthOf(pts);
  if (!total) return null;
  const at = Math.min(1, Math.max(0, t)) * total;
  const p = pointAtLength(pts, at);
  const step = Math.min(2, total / 2) || 1;
  const a = pointAtLength(pts, Math.max(0, at - step));
  const b = pointAtLength(pts, Math.min(total, at + step));
  return { x: p.x, y: p.y, angle: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI };
}
