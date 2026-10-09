// The op-list: the seam between a node definition and a renderer.
//
// A component's drawNode() returns a flat array of these. They carry geometry
// in NODE-LOCAL coordinates (0,0 is the node's top-left) and reference theme
// TOKENS rather than literal colours — resolution happens in the renderer, so
// the same op-list themes differently without the component knowing.
//
// No SVG strings, no React elements. That is the whole point: the headless
// walker turns these into SVG text with no DOM, and the React walker turns the
// same array into JSX. Interaction chrome — handles, resizer, selection ring —
// never appears here.

export const OP = {
  RECT: "rect",
  ELLIPSE: "ellipse",
  PATH: "path",
  LINE: "line",
  LABEL: "label",
  GROUP: "group",
} as const;

// Fill and stroke are theme tokens ("node.fill") or, in a pinch, literals; see
// theme.ts. `width` is the stroke's, and `dash` an SVG stroke-dasharray.
export type Paint = {
  fill: string;
  stroke: string;
  width: number;
  dash?: string;
};

export type RectOp = Paint & {
  op: typeof OP.RECT;
  x: number;
  y: number;
  w: number;
  h: number;
  rx: number;
};

export type EllipseOp = Paint & {
  op: typeof OP.ELLIPSE;
  cx: number;
  cy: number;
  rx: number;
  ry: number;
};

export type PathOp = Paint & { op: typeof OP.PATH; d: string };

export type LineOp = Paint & {
  op: typeof OP.LINE;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

export type LabelOp = {
  op: typeof OP.LABEL;
  x: number;
  y: number;
  w: number;
  h: number;
  align: "left" | "center" | "right";
  valign: "top" | "middle" | "bottom";
  size: number;
  weight: number;
  fill: string;
  slot: string;
};

export type GroupOp = { op: typeof OP.GROUP; children: Op[] };

export type Op = RectOp | EllipseOp | PathOp | LineOp | LabelOp | GroupOp;

// Per-op overrides: anything but the op's own kind.
type Options<T extends Op> = Partial<Omit<T, "op">>;
export type LabelOptions = Options<LabelOp>;

// Default token references. A generator overrides these per op when a shape
// needs a second surface (a stacked copy behind, a shaded band).
const FILL = "node.fill";
const STROKE = "node.stroke";
const INK = "node.ink";

export const rect = (
  x: number,
  y: number,
  w: number,
  h: number,
  o: Options<RectOp> = {},
): RectOp => ({
  op: OP.RECT,
  x,
  y,
  w,
  h,
  rx: 0,
  fill: FILL,
  stroke: STROKE,
  width: 1.5,
  ...o,
});

export const ellipse = (
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  o: Options<EllipseOp> = {},
): EllipseOp => ({
  op: OP.ELLIPSE,
  cx,
  cy,
  rx,
  ry,
  fill: FILL,
  stroke: STROKE,
  width: 1.5,
  ...o,
});

export const path = (d: string, o: Options<PathOp> = {}): PathOp => ({
  op: OP.PATH,
  d,
  fill: FILL,
  stroke: STROKE,
  width: 1.5,
  ...o,
});

export const line = (
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  o: Options<LineOp> = {},
): LineOp => ({
  op: OP.LINE,
  x1,
  y1,
  x2,
  y2,
  fill: "none",
  stroke: STROKE,
  width: 1.5,
  ...o,
});

// What a label slot draws in unless its shape says otherwise. Mermaid's own
// size, so a box it laid out around its text holds the same text here. The
// sequence importer sizes its boxes with it too.
export const LABEL_FONT = { size: 16, weight: 600 };

// A text box, not a text run. Geometry only — the renderer decides whether it
// becomes an SVG <text> or an editable HTML overlay, which is what lets the
// canvas have double-click editing while the headless walker still draws text.
export const label = (
  x: number,
  y: number,
  w: number,
  h: number,
  o: LabelOptions = {},
): LabelOp => ({
  op: OP.LABEL,
  x,
  y,
  w,
  h,
  align: "center",
  valign: "middle",
  size: LABEL_FONT.size,
  weight: LABEL_FONT.weight,
  fill: INK,
  slot: "label",
  ...o,
});

export const group = (children: Op[], o: Options<GroupOp> = {}): GroupOp => ({
  op: OP.GROUP,
  children,
  ...o,
});

// Convenience used by nearly every generator: a decoration is a thin rule in
// the muted token with no fill.
export const rule = (
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  o: Options<LineOp> = {},
): LineOp => line(x1, y1, x2, y2, { stroke: "node.rule", width: 1.25, ...o });

export const isOp = (v: unknown): v is Op =>
  Boolean(v && typeof v === "object" && "op" in v && v.op);

// Flattens groups so a walker can iterate without recursing if it prefers.
export const flatten = (
  ops: Op[],
  out: Exclude<Op, GroupOp>[] = [],
): Exclude<Op, GroupOp>[] => {
  for (const o of ops) {
    if (!isOp(o)) continue;
    if (o.op === OP.GROUP) flatten(o.children ?? [], out);
    else out.push(o);
  }
  return out;
};
