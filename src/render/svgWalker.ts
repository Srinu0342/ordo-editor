// Headless walker: op-list -> SVG text. Plain Node, no DOM, no jsdom, no React.
//
// This is half of WS3's done-condition. It is also what makes Ordo renderable
// on a server, in CI, and in a git hook without a browser — the environment
// constraint that WS4's harvest-vs-relayout decision turns on.

import { OP } from "../ops.ts";
import type { Op, Paint } from "../ops.ts";
import { LIGHT, resolve } from "../theme.ts";
import type { Theme } from "../theme.ts";

// Slot name → the text drawn in it.
type Text = Record<string, string>;

const esc = (s: unknown) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// Emitted only when set, so the output stays diffable and does not carry a
// wall of default attributes on every mark.
const attrs = (o: Record<string, unknown>) => {
  const out: string[] = [];
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined || v === null || v === "") continue;
    out.push(`${k}="${esc(v)}"`);
  }
  return out.join(" ");
};

const paint = (theme: Theme, o: Paint) => ({
  fill: resolve(theme, o.fill ?? "none"),
  stroke: resolve(theme, o.stroke ?? "none"),
  "stroke-width": o.stroke && o.stroke !== "none" ? o.width : undefined,
  "stroke-dasharray": o.dash || undefined,
  "stroke-linejoin": "round",
  "stroke-linecap": "round",
});

const ANCHOR = { left: "start", center: "middle", right: "end" };

function one(op: Op, theme: Theme, text: Text): string {
  switch (op.op) {
    case OP.RECT:
      return `<rect ${attrs({ x: op.x, y: op.y, width: op.w, height: op.h, rx: op.rx || undefined, ...paint(theme, op) })}/>`;
    case OP.ELLIPSE:
      return `<ellipse ${attrs({ cx: op.cx, cy: op.cy, rx: op.rx, ry: op.ry, ...paint(theme, op) })}/>`;
    case OP.PATH:
      return `<path ${attrs({ d: op.d, ...paint(theme, op) })}/>`;
    case OP.LINE:
      return `<line ${attrs({ x1: op.x1, y1: op.y1, x2: op.x2, y2: op.y2, ...paint(theme, op) })}/>`;
    case OP.LABEL: {
      const value = text?.[op.slot] ?? "";
      if (!value) return "";
      const x =
        op.align === "left"
          ? op.x
          : op.align === "right"
            ? op.x + op.w
            : op.x + op.w / 2;
      return `<text ${attrs({
        x,
        y: op.y + op.h / 2,
        fill: resolve(theme, op.fill),
        "font-size": op.size,
        "font-weight": op.weight,
        "font-family": "system-ui, sans-serif",
        "text-anchor": ANCHOR[op.align] ?? "middle",
        "dominant-baseline": "central",
      })}>${esc(value)}</text>`;
    }
    case OP.GROUP:
      return `<g>${(op.children ?? []).map((c) => one(c, theme, text)).join("")}</g>`;
    default:
      return "";
  }
}

// `text` maps slot name -> string, so the same op-list renders with whatever
// content the document carries rather than baking content into geometry.
export function opsToSvgBody(
  ops: Op[],
  { theme = LIGHT, text = {} }: { theme?: Theme; text?: Text } = {},
) {
  return ops.map((o) => one(o, theme, text)).join("");
}

export function opsToSvg(
  ops: Op[],
  {
    width,
    height,
    theme = LIGHT,
    text = {},
    pad = 0,
  }: { width: number; height: number; theme?: Theme; text?: Text; pad?: number },
) {
  const vb = `${-pad} ${-pad} ${width + pad * 2} ${height + pad * 2}`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="${width + pad * 2}" height="${height + pad * 2}">` +
    opsToSvgBody(ops, { theme, text }) +
    `</svg>`
  );
}

// Data URI for an <img src>, which is how the palette shows previews without
// mounting a React tree per swatch.
export const svgDataUri = (svg: string) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
