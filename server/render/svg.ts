import { renderToStaticMarkup } from "react-dom/server";
import { EDGE_LABEL_FONT, inkOf } from "../../src/edgeStyle.ts";
import { MARKERS } from "../../src/edges/markers.tsx";
import { LINE_HEIGHT } from "../../src/measure.ts";
import { GROUP_FONT, TEXT_FONT, TEXT_PAD } from "../../src/nodes/defaults.ts";
import { bracket, drawFragment, guardIndex } from "../../src/nodes/fragment.ts";
import { TUBE_TYPE, drawTube } from "../../src/nodes/tube.ts";
import { OP, flatten } from "../../src/ops.ts";
import type { LabelOp, Op } from "../../src/ops.ts";
import { opsToSvgBody } from "../../src/render/svgWalker.ts";
import { DEFAULT_SHAPE, drawShape } from "../../src/shapes/registry.ts";
import { alignOf, fontOf } from "../../src/textStyle.ts";
import type { Font } from "../../src/textStyle.ts";
import { LIGHT, resolve } from "../../src/theme.ts";
import type { Scene, SceneEdge, SceneNode } from "./scene.ts";
import { FONT_FAMILY, NORMAL_LINE, baselineOf, classLayout, widthOf } from "./text.ts";

// A scene as one SVG, drawn the way the canvas draws each part: a box from its
// shape's op-list (svgWalker), the other kinds from the numbers their
// components lay out with, the line under it all from the same marker shapes.
// Light theme, on white. Nothing the canvas shows only while editing — handles,
// a selection, the placeholder in an empty label — is drawn.

const THEME = LIGHT;
const PAD = 24; // round the drawing

const esc = (s: unknown) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const r2 = (v: number) => Math.round(v * 100) / 100;

type Box = { x: number; y: number; w: number; h: number };
type Align = "left" | "center" | "right";

/** Ids for clip paths and markers, unique within one drawing. */
class Defs {
  private n = 0;
  readonly out: string[] = [];
  private markers = new Map<string, string>();

  clip(box: Box, rx = 0): string {
    const id = `c${this.n++}`;
    this.out.push(`<clipPath id="${id}"><rect x="${r2(box.x)}" y="${r2(box.y)}" width="${r2(box.w)}" height="${r2(box.h)}"${rx ? ` rx="${rx}"` : ""}/></clipPath>`);
    return id;
  }

  /**
   * The marker `key` (edges/markers.tsx) in `color`, for the line's `at` end.
   * The canvas paints its markers with context-stroke through CSS variables;
   * here each colour gets its own copy, with the colour written in. resvg 2.6
   * reads orient="auto-start-reverse" as 0°, which points every marker right,
   * so a start marker is a copy of its own, turned half round, with orient="auto".
   */
  marker(key: string | undefined, color: string, at: "start" | "end"): string | undefined {
    const m = key && key !== "none" ? MARKERS[key] : undefined;
    if (!m?.body) return undefined;
    const name = `${key} ${color} ${at}`;
    let id = this.markers.get(name);
    if (!id) {
      id = `m${this.markers.size}`;
      this.markers.set(name, id);
      let body = renderToStaticMarkup(m.body)
        .replace(/var\(--mk-(?:line|solid), context-stroke\)/g, color)
        .replace(/var\(--mk-hollow, [^)]*\)/g, THEME["canvas.bg"]);
      if (at === "start") body = `<g transform="rotate(180 ${m.w / 2} ${m.h / 2})">${body}</g>`;
      const refX = at === "start" ? m.w - m.refX : m.refX;
      this.out.push(
        `<marker id="${id}" viewBox="0 0 ${m.w} ${m.h}" markerWidth="${m.w}" markerHeight="${m.h}" refX="${refX}" refY="${m.h / 2}" orient="auto" markerUnits="userSpaceOnUse">${body}</marker>`,
      );
    }
    return id;
  }
}

/** One line of text, its left edge at `left`, in a line box `lineH` tall from `top`. */
function line(text: string, left: number, top: number, lineH: number, font: Font, fill: string): string {
  if (!text) return "";
  const y = baselineOf(top, lineH, font.size);
  return `<text x="${r2(left)}" y="${r2(y)}" font-family="${FONT_FAMILY}" font-size="${font.size}" font-weight="${font.weight}" fill="${esc(fill)}" xml:space="preserve">${esc(text)}</text>`;
}

/**
 * Lines of text set as EditableLabel sets them: a block as wide as its widest
 * line (plus 2 px of caret room) and no wider than `box`, placed in the box by
 * `align` and `valign`, its lines lined up inside it by `lineAlign`. A line
 * too long for the block starts at its left and runs on, as `white-space: pre`
 * does.
 */
function block(
  text: string,
  box: Box,
  o: { font: Font; lineH: number; fill: string; align: Align; valign?: "top" | "middle" | "bottom"; lineAlign?: Align },
): string {
  const lines = text.split("\n");
  if (!text) return "";
  const lineH = o.font.size * o.lineH;
  const widths = lines.map((l) => widthOf(l, o.font));
  const bw = Math.min(Math.max(...widths) + 2, box.w);
  const bh = lines.length * lineH;
  const left = o.align === "left" ? box.x : o.align === "right" ? box.x + box.w - bw : box.x + (box.w - bw) / 2;
  const valign = o.valign ?? "middle";
  const top = valign === "top" ? box.y : valign === "bottom" ? box.y + box.h - bh : box.y + (box.h - bh) / 2;
  const inner = bw - 2;
  const lineAlign = o.lineAlign ?? o.align;
  return lines
    .map((l, i) => {
      const room = Math.max(0, inner - widths[i]);
      const x = lineAlign === "left" ? left : lineAlign === "right" ? left + room : left + room / 2;
      return line(l, x, top + i * lineH, lineH, o.font, o.fill);
    })
    .join("");
}

/** A label slot of an op-list, clipped to its box as labelBox clips it. */
function slot(op: LabelOp, value: string, font: Font, defs: Defs): string {
  if (!value) return "";
  const box = { x: op.x, y: op.y, w: op.w, h: op.h };
  const fill = resolve(THEME, op.fill) ?? THEME["node.ink"];
  const text = block(value, box, { font, lineH: NORMAL_LINE, fill, align: op.align, valign: op.valign });
  return text && `<g clip-path="url(#${defs.clip(box)})">${text}</g>`;
}

/** An op-list's marks through svgWalker, and its label slots set here. */
function opList(ops: Op[], text: (op: LabelOp) => string, font: (op: LabelOp) => Font, defs: Defs, theme = THEME): string {
  const flat = flatten(ops);
  const marks = opsToSvgBody(flat.filter((op) => op.op !== OP.LABEL), { theme });
  const labels = flat.filter((op): op is LabelOp => op.op === OP.LABEL).map((op) => slot(op, text(op), font(op), defs));
  return marks + labels.join("");
}

// ---------------------------------------------------------------------------
// Nodes, in their own coordinates (0,0 at the top-left)
// ---------------------------------------------------------------------------

function boxNode(n: SceneNode, defs: Defs): string {
  return opList(
    drawShape(n.data.shape ?? DEFAULT_SHAPE, n.w, n.h),
    (op) => String((n.data as Record<string, unknown>)[op.slot] ?? ""),
    (op) => fontOf({ size: op.size, weight: op.weight }, n.data),
    defs,
  );
}

// ContainerNode: a dashed frame inside the box, and its title on a chip that
// straddles the top border, 10 px in from the left.
const GROUP_DASH = "4.5 3";
function groupChip(n: SceneNode): { box: Box; font: Font; label: string } | null {
  const label = n.data.label ?? "";
  if (!label) return null;
  const font = fontOf(GROUP_FONT, n.data);
  const lines = label.split("\n");
  const w = Math.max(...lines.map((l) => widthOf(l, font))) + 2 + 12;
  const h = lines.length * font.size * NORMAL_LINE;
  return { box: { x: 11.5, y: -1.5 - h / 2, w, h }, font, label };
}

function groupNode(n: SceneNode): string {
  const frame = `<rect x="0.75" y="0.75" width="${r2(n.w - 1.5)}" height="${r2(n.h - 1.5)}" rx="5.25" fill="none" stroke="${THEME["node.stroke"]}" stroke-width="1.5" stroke-dasharray="${GROUP_DASH}"/>`;
  const chip = groupChip(n);
  if (!chip) return frame;
  const { box, font, label } = chip;
  return (
    frame +
    `<rect x="${r2(box.x)}" y="${r2(box.y)}" width="${r2(box.w)}" height="${r2(box.h)}" rx="3" fill="${THEME["container.band"]}"/>` +
    block(label, { x: box.x + 6, y: box.y, w: box.w - 12, h: box.h }, { font, lineH: NORMAL_LINE, fill: THEME["node.ink.muted"], align: "left" })
  );
}

// CompartmentNode: a name band over compartments of rows, inside a 1.5 px
// border with 3 px corners; anything past the edge is cut off.
function classNode(n: SceneNode, defs: Defs): string {
  const L = classLayout(n.data);
  const [w, h] = [n.w, L.height];
  const rule = (y: number) => `<line x1="1.5" y1="${r2(y)}" x2="${r2(w - 1.5)}" y2="${r2(y)}" stroke="${THEME["node.stroke"]}" stroke-width="1.5"/>`;
  const clip = defs.clip({ x: 0, y: 0, w, h }, 3);
  const inside = [
    `<rect x="1.5" y="1.5" width="${r2(w - 3)}" height="${r2(L.bandH)}" fill="${THEME["node.shade"]}"/>`,
    rule(1.5 + L.bandH + 0.75),
    block(n.data.label ?? "", { x: 1.5 + 9, y: 1.5 + 5, w: w - 3 - 18, h: L.bandH - 10 }, {
      font: L.font,
      lineH: NORMAL_LINE,
      fill: THEME["node.ink"],
      align: "center",
      lineAlign: "left",
    }),
    ...L.sections.flatMap((s, i) => [
      ...s.rows.map((row, ri) =>
        block(row, { x: 1.5 + 9, y: s.rowsTop + ri * s.rowH + 3, w: w - 3 - 18, h: s.rowH - 6 }, {
          font: L.rowFont,
          lineH: NORMAL_LINE,
          fill: THEME["node.ink"],
          align: "left",
        }),
      ),
      i < L.sections.length - 1 ? rule(s.bottom + 0.75) : "",
    ]),
  ].join("");
  return (
    `<rect x="0.75" y="0.75" width="${r2(w - 1.5)}" height="${r2(h - 1.5)}" rx="2.25" fill="${THEME["node.fill"]}"/>` +
    `<g clip-path="url(#${clip})">${inside}</g>` +
    `<rect x="0.75" y="0.75" width="${r2(w - 1.5)}" height="${r2(h - 1.5)}" rx="2.25" fill="none" stroke="${THEME["node.stroke"]}" stroke-width="1.5"/>`
  );
}

// LabelNode: words with no frame, centred in a box padded 3 px by 5 px inside a
// 1 px border nobody sees, lines lined up by textAlign.
function textNode(n: SceneNode): string {
  const [py, px] = TEXT_PAD;
  const inset = { x: px + 1, y: py + 1 };
  return block(n.data.label ?? "", { x: inset.x, y: inset.y, w: n.w - 2 * inset.x, h: n.h - 2 * inset.y }, {
    font: fontOf(TEXT_FONT, n.data),
    lineH: LINE_HEIGHT,
    fill: THEME["node.ink"],
    align: "center",
    lineAlign: alignOf(n.data),
  });
}

// TubeNode: drawTube, outlined in the accent while it rides an edge.
function tubeNode(n: SceneNode, defs: Defs): string {
  const theme = n.data.attach ? { ...THEME, "node.stroke": THEME["node.accent"] } : THEME;
  return opList(drawTube(n.w, n.h, n.data), () => "", (op) => op, defs, theme);
}

// FragmentNode: drawFragment, with each guard in brackets but a box's title.
function fragmentNode(n: SceneNode, defs: Defs): string {
  const operator = n.data.operator ?? "";
  const text = (op: LabelOp) => {
    if (op.slot === "operator") return operator;
    const guard = n.data.guards?.[guardIndex(op.slot)] ?? "";
    return operator === "box" ? guard : bracket(guard);
  };
  return opList(drawFragment(n.w, n.h, n.data), text, (op) => op, defs);
}

function nodeBody(n: SceneNode, defs: Defs): string {
  switch (n.type) {
    case "container":
      return groupNode(n);
    case "compartment":
      return classNode(n, defs);
    case "label":
      return textNode(n);
    case TUBE_TYPE:
      return tubeNode(n, defs);
    case "fragment":
      return fragmentNode(n, defs);
    default:
      return boxNode(n, defs);
  }
}

function drawNode(n: SceneNode, defs: Defs): string {
  const turn = n.angle ? ` rotate(${r2(n.angle)} ${r2(n.w / 2)} ${r2(n.h / 2)})` : "";
  return `<g transform="translate(${r2(n.x)} ${r2(n.y)})${turn}">${nodeBody(n, defs)}</g>`;
}

// ---------------------------------------------------------------------------
// Edges
// ---------------------------------------------------------------------------

const strokeOf = (e: SceneEdge) => inkOf(String(e.style?.stroke ?? THEME["edge.stroke"]), THEME);

function drawEdge(e: SceneEdge, defs: Defs): string {
  const style = (e.style ?? {}) as Record<string, unknown>;
  const stroke = strokeOf(e);
  const start = defs.marker(e.data?.markerStart, stroke, "start");
  const end = defs.marker(e.data?.markerEnd, stroke, "end");
  const dash = typeof style.strokeDasharray === "string" && style.strokeDasharray ? ` stroke-dasharray="${esc(style.strokeDasharray)}"` : "";
  return (
    `<path d="${esc(e.d)}" fill="none" stroke="${esc(stroke)}" stroke-width="${Number(style.strokeWidth ?? 1)}"${dash}` +
    `${start ? ` marker-start="url(#${start})"` : ""}${end ? ` marker-end="url(#${end})"` : ""}/>`
  );
}

// OrdoEdge's pill: 13 px text, 1.4 line height, padded 2 px by 8 px (and the
// 2 px of caret room) inside a 1 px border, on the point the router returns.
const LABEL_GAP = 4;
function pill(e: SceneEdge): { box: Box; font: Font; lines: string[] } | null {
  const label = String(e.data?.label ?? "");
  if (!label) return null;
  const font = fontOf(EDGE_LABEL_FONT, e.data);
  const lines = label.split("\n");
  const w = Math.max(...lines.map((l) => widthOf(l, font))) + 2 + 16 + 2;
  const h = lines.length * font.size * 1.4 + 4 + 2;
  const { labelX: x, labelY: y } = e;
  const place = e.data?.labelPlacement ?? "center";
  const box =
    place === "above"
      ? { x: x - w / 2, y: y - LABEL_GAP - h, w, h }
      : place === "right"
        ? { x: x + LABEL_GAP, y: y - h / 2, w, h }
        : { x: x - w / 2, y: y - h / 2, w, h };
  return { box, font, lines };
}

function drawPill(e: SceneEdge): string {
  const p = pill(e);
  if (!p) return "";
  const { box, font, lines } = p;
  const rx = lines.length > 1 ? 7.5 : (box.h - 1) / 2;
  const lineH = font.size * 1.4;
  return (
    `<rect x="${r2(box.x + 0.5)}" y="${r2(box.y + 0.5)}" width="${r2(box.w - 1)}" height="${r2(box.h - 1)}" rx="${r2(rx)}" fill="${THEME["node.fill"]}" stroke="${THEME["node.rule"]}" stroke-width="1"/>` +
    lines.map((l, i) => line(l, box.x + 1 + 8, box.y + 1 + 2 + i * lineH, lineH, font, THEME["node.ink"])).join("")
  );
}

// ---------------------------------------------------------------------------
// The drawing
// ---------------------------------------------------------------------------

/** What the drawing covers: every node, line, marker and label. */
function bounds(scene: Scene): Box {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  const add = (x: number, y: number) => {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  };
  for (const n of scene.nodes) {
    if (n.type === TUBE_TYPE && n.data.variant === "track") continue; // draws nothing
    const rad = (n.angle * Math.PI) / 180;
    const [cx, cy] = [n.x + n.w / 2, n.y + n.drawH / 2];
    const hw = (Math.abs(Math.cos(rad)) * n.w + Math.abs(Math.sin(rad)) * n.drawH) / 2;
    const hh = (Math.abs(Math.sin(rad)) * n.w + Math.abs(Math.cos(rad)) * n.drawH) / 2;
    add(cx - hw, cy - hh);
    add(cx + hw, cy + hh);
    const chip = n.type === "container" ? groupChip(n) : null;
    if (chip) {
      add(n.x + chip.box.x, n.y + chip.box.y);
      add(n.x + chip.box.x + chip.box.w, n.y + chip.box.y + chip.box.h);
    }
  }
  for (const e of scene.edges) {
    for (const p of e.points) {
      add(p.x - 8, p.y - 8); // room for a marker
      add(p.x + 8, p.y + 8);
    }
    const p = pill(e);
    if (p) {
      add(p.box.x, p.box.y);
      add(p.box.x + p.box.w, p.box.y + p.box.h);
    }
  }
  if (x0 === Infinity) return { x: 0, y: 0, w: 1, h: 1 };
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** The scene as SVG text, and its size in px. */
export function sceneToSvg(scene: Scene): { svg: string; width: number; height: number } {
  const defs = new Defs();

  // Stacked as React Flow stacks them: by z, and at the same z, lines under
  // their labels under the nodes, each in the order the diagram lists them.
  // Every label sits at 1001, over all but a raised node.
  type Item = { z: number; layer: number; index: number; svg: string };
  const items: Item[] = [
    ...scene.edges.map((e) => ({ z: e.z, layer: 0, index: e.index, svg: drawEdge(e, defs) })),
    ...scene.edges.map((e) => ({ z: 1001, layer: 1, index: e.index, svg: drawPill(e) })),
    ...scene.nodes.map((n) => ({ z: n.z, layer: 2, index: n.index, svg: drawNode(n, defs) })),
  ];
  items.sort((a, b) => a.z - b.z || a.layer - b.layer || a.index - b.index);

  const b = bounds(scene);
  const [x, y] = [Math.floor(b.x - PAD), Math.floor(b.y - PAD)];
  const [width, height] = [Math.ceil(b.x + b.w + PAD) - x, Math.ceil(b.y + b.h + PAD) - y];
  const body = items.map((i) => i.svg).join("");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${x} ${y} ${width} ${height}">` +
    `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${THEME["canvas.bg"]}"/>` +
    `<defs>${defs.out.join("")}</defs>${body}</svg>`;
  return { svg, width, height };
}
