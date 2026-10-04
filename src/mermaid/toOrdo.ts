import { SHAPES, DEFAULT_SHAPE } from "../shapes/registry.ts";
import { DEFAULT_EDGE_STYLE, applyEdgeStyle } from "../edgeStyle.ts";
import type { LayoutData } from "mermaid";
import type { MermaidLayout, Subgraph } from "./extractor.ts";
import type { OrdoEdge, OrdoNode, XY } from "../types.ts";

type LayoutEdge = LayoutData["edges"][number];

// data4Layout -> { nodes, edges } for React Flow.
//
// This file is a TRANSLATOR, not an extractor. It never touches Mermaid: it
// takes whatever `getMermaidLayoutForOrdo` hands back and restates it in the
// vocabulary the canvas already speaks — shape keys from the registry, edge
// style through `applyEdgeStyle`, containment through parentId.
//
// Three things Mermaid says differently from us, and this is the only place
// that knows about any of them:
//   1. shape names arrive in three vocabularies (see resolveShape)
//   2. x/y are CENTRES in one flat absolute space; React Flow wants top-left
//      relative to the parent
//   3. arrowheads, dash and thickness are separate fields, not one enum

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

// Mermaid's own alias table: every documented spelling of a shape, mapped to
// its canonical shortName. Lifted verbatim from the shape registry in
// mermaid@12, so `@{ shape: database }` and `@{ shape: cyl }` land together.
const ALIASES: Record<string, string> = {
  "bow-tie-rectangle": "bow-rect",
  "brace-l": "brace",
  card: "notch-rect",
  circ: "circle",
  collate: "hourglass",
  "com-link": "bolt",
  comment: "brace",
  "crossed-circle": "cross-circ",
  "curved-trapezoid": "curv-trap",
  cylinder: "cyl",
  das: "h-cyl",
  "data-store": "datastore",
  database: "cyl",
  db: "cyl",
  decision: "diam",
  diamond: "diam",
  directory: "folder",
  disk: "lin-cyl",
  display: "curv-trap",
  "div-proc": "div-rect",
  "divided-process": "div-rect",
  "divided-rectangle": "div-rect",
  document: "doc",
  documents: "docs",
  "double-circle": "dbl-circ",
  event: "rounded",
  extract: "tri",
  "filled-circle": "f-circ",
  "flipped-triangle": "flip-tri",
  "framed-circle": "fr-circ",
  "framed-rectangle": "fr-rect",
  "half-rounded-rectangle": "delay",
  hexagon: "hex",
  "horizontal-cylinder": "h-cyl",
  "in-out": "lean-r",
  "internal-storage": "win-pane",
  "inv-trapezoid": "trap-t",
  join: "fork",
  junction: "f-circ",
  "lean-left": "lean-l",
  "lean-right": "lean-r",
  "lightning-bolt": "bolt",
  "lin-proc": "lin-rect",
  "lined-cylinder": "lin-cyl",
  "lined-document": "lin-doc",
  "lined-process": "lin-rect",
  "lined-rectangle": "lin-rect",
  "loop-limit": "notch-pent",
  manual: "trap-t",
  "manual-file": "flip-tri",
  "manual-input": "sl-rect",
  "notched-pentagon": "notch-pent",
  "notched-rectangle": "notch-rect",
  "out-in": "lean-l",
  "paper-tape": "flag",
  pill: "stadium",
  prepare: "hex",
  priority: "trap-b",
  proc: "rect",
  process: "rect",
  processes: "st-rect",
  procs: "st-rect",
  question: "diam",
  rectangle: "rect",
  "shaded-process": "lin-rect",
  "sloped-rectangle": "sl-rect",
  "small-circle": "sm-circ",
  "st-doc": "docs",
  "stacked-document": "docs",
  "stacked-rectangle": "st-rect",
  start: "sm-circ",
  stop: "fr-circ",
  "stored-data": "bow-rect",
  subproc: "fr-rect",
  subprocess: "fr-rect",
  subroutine: "fr-rect",
  summary: "cross-circ",
  "tag-proc": "tag-rect",
  "tagged-document": "tag-doc",
  "tagged-process": "tag-rect",
  "tagged-rectangle": "tag-rect",
  terminal: "stadium",
  trapezoid: "trap-b",
  "trapezoid-bottom": "trap-b",
  "trapezoid-top": "trap-t",
  triangle: "tri",
  "window-pane": "win-pane",
};

// Sentinel: not a shape at all. These become the `label` node type, which is
// our equivalent of a bare text block.
const AS_LABEL = "\u0000label";

// The third vocabulary. Classic syntax (`A[x]`, `B{x}`) never reaches the
// shape registry — the parser emits its own internal names and most of them
// fall through unchanged. These are the ones that do NOT match a registry
// shortName or alias, so they need stating explicitly.
const LEGACY: Record<string, string> = {
  squareRect: "rect",
  roundedRect: "rounded",
  ellipse: "circle",
  doublecircle: "dbl-circ",
  lean_right: "lean-r",
  lean_left: "lean-l",
  inv_trapezoid: "trap-t",
  rect_left_inv_arrow: "odd",
  note: "brace",
  anchor: "sm-circ",
  labelRect: AS_LABEL,
  text: AS_LABEL,
  // Icon and image nodes have no Ordo equivalent yet; a plain box is the
  // honest fallback rather than dropping the node.
  icon: "rect",
  iconCircle: "circle",
  iconSquare: "rect",
  iconRounded: "rounded",
  imageSquare: "rect",
};

// Registry first for anything Mermaid and Ordo already spell the same way,
// then aliases, then the legacy patch table. Anything still unknown becomes a
// rectangle: an unrecognised shape should render as SOMETHING, which is the
// same bargain `shapeDef` strikes.
export function resolveShape(raw: string | undefined) {
  if (!raw) return DEFAULT_SHAPE;
  if (LEGACY[raw]) return LEGACY[raw];
  if (SHAPES[raw]) return raw;
  const alias = ALIASES[raw];
  if (alias && SHAPES[alias]) return alias;
  return DEFAULT_SHAPE;
}

// ---------------------------------------------------------------------------
// Edges
// ---------------------------------------------------------------------------

// `arrowTypeStart` / `arrowTypeEnd` arrive as arrow_point | arrow_circle |
// arrow_cross | none. Stripping the prefix leaves exactly the names in the
// payload's own `markers` array.
const MARKERS: Record<string, string> = {
  point: "arrow-filled",
  circle: "circle",
  cross: "cross",
  none: "none",
};

const marker = (raw: string | undefined) =>
  MARKERS[String(raw ?? "none").replace(/^(double_)?arrow_/, "")] ?? "none";

// `curve` is a d3 interpolator name. Ours is a routing mode; several of theirs
// collapse onto each of ours.
const ROUTE_BY_CURVE: Record<string, string> = {
  linear: "straight",
  basis: "curved",
  natural: "curved",
  cardinal: "curved",
  catmullRom: "curved",
  monotoneX: "curved",
  monotoneY: "curved",
  step: "orthogonal",
  stepBefore: "orthogonal",
  stepAfter: "orthogonal",
};

// Every anchor on a node is declared `type="source"` (the canvas runs in loose
// connection mode), so React Flow cannot infer a side: left undefined it grabs
// the first handle it finds — "n" — at BOTH ends, and every edge leaves the top
// and arrives at the top. Mermaid never sends port information, so the side has
// to be derived from the geometry it does send.
const BY_DIRECTION: Record<string, [source: string, target: string]> = {
  TB: ["s", "n"],
  TD: ["s", "n"],
  BT: ["n", "s"],
  LR: ["e", "w"],
  RL: ["w", "e"],
};

// Dominant axis between the two centres decides the pair, so a back-edge or a
// sideways hop anchors sensibly instead of following the diagram direction off
// the wrong face. Direction is only the fallback for coincident centres.
function handlesFor(
  from: XY | undefined,
  to: XY | undefined,
  direction: string | undefined,
): [source: string, target: string] {
  const fallback = BY_DIRECTION[direction ?? ""] ?? BY_DIRECTION.TB;
  if (!from || !to) return fallback;

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === 0) return fallback;

  if (Math.abs(dy) >= Math.abs(dx)) return dy >= 0 ? ["s", "n"] : ["n", "s"];
  return dx >= 0 ? ["e", "w"] : ["w", "e"];
}

// `pattern` and `thickness` both carry the stroke keyword; either can be the
// one that is set, so read both.
function strokeOf(edge: LayoutEdge) {
  const kind = edge?.pattern ?? edge?.thickness ?? "normal";
  const thick = kind === "thick" || edge?.thickness === "thick";
  return {
    dash: kind === "dotted" ? "1 5" : "",
    strokeWidth: thick ? 3 : DEFAULT_EDGE_STYLE.strokeWidth,
    invisible: kind === "invisible",
  };
}

// ---------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------

// React Flow requires a parent to appear BEFORE its children. Marked before
// recursing so a malformed parent chain cannot hang the import.
function sortParentsFirst(nodes: OrdoNode[]) {
  const byId = new Map<string | undefined, OrdoNode>(
    nodes.map((n) => [n.id, n]),
  );
  const seen = new Set<string>();
  const out: OrdoNode[] = [];
  const visit = (n: OrdoNode | undefined) => {
    if (!n || seen.has(n.id)) return;
    seen.add(n.id);
    visit(byId.get(n.parentId));
    out.push(n);
  };
  nodes.forEach(visit);
  return out;
}

// ---------------------------------------------------------------------------

const DEFAULT_W = 160;
const DEFAULT_H = 48;

/**
 * @param payload  whatever the extractor returns: either data4Layout itself,
 *                 or { mermaid: data4Layout, subgraphs: [...] }.
 * @returns { nodes, edges, unsupported } — `unsupported` lists shapes Mermaid
 *          named that we drew as a rectangle, so the caller can say so.
 */
export function toOrdo(payload: MermaidLayout | LayoutData | null | undefined): {
  nodes: OrdoNode[];
  edges: OrdoEdge[];
  unsupported: string[];
} {
  // LayoutData is open-ended (any key reads as `any`), so both are pinned here.
  const layout: Partial<LayoutData> = payload?.mermaid ?? payload ?? {};
  const subgraphs: Subgraph[] = payload?.subgraphs ?? [];
  const source = Array.isArray(layout.nodes) ? layout.nodes : [];

  // Direct membership, kept only so a COLLAPSED subgraph does not lose what
  // was inside it — Mermaid drops those children from `nodes` entirely.
  const membersOf = new Map(subgraphs.map((s) => [s.id, s.nodes ?? []]));

  // Every node's absolute top-left, derived once. Mermaid gives centres in a
  // single flat space, including for nodes that sit inside a group.
  const topLeft = new Map(
    source.map((n) => [
      n.id,
      {
        x: (n.x ?? 0) - (n.width ?? DEFAULT_W) / 2,
        y: (n.y ?? 0) - (n.height ?? DEFAULT_H) / 2,
      },
    ]),
  );

  // Centres, kept as Mermaid gives them, purely to choose which face of a node
  // each edge should leave from and arrive at.
  const centre = new Map<string | undefined, XY>(
    source.map((n) => [n.id, { x: n.x ?? 0, y: n.y ?? 0 }]),
  );

  const unsupported = new Set<string>();

  const nodes = source.map((n): OrdoNode => {
    const width = n.width ?? DEFAULT_W;
    const height = n.height ?? DEFAULT_H;

    const here = topLeft.get(n.id) ?? { x: 0, y: 0 };
    const origin = n.parentId ? topLeft.get(n.parentId) : null;
    const position = origin
      ? { x: here.x - origin.x, y: here.y - origin.y }
      : { x: here.x, y: here.y };

    // A collapsed subgraph arrives as isGroup:false with a sentinel shape.
    // It is still a container to us — just an empty one.
    const collapsed = n.shape === "collapsedGroup";
    const isGroup = n.isGroup === true || collapsed;

    // Groups hardcode shape:"rect" upstream, so they must never be routed
    // through the shape table or every subgraph becomes a plain box.
    const shape = isGroup ? null : resolveShape(n.shape);

    // Report anything that did not land on a real registry entry, so the
    // caller can say "drawn as a rectangle" rather than quietly lying. A
    // label sentinel is a successful mapping, not a miss.
    if (!isGroup && n.shape && shape !== AS_LABEL && !SHAPES[shape!]) {
      unsupported.add(n.shape);
    }
    if (!isGroup && n.shape && shape === DEFAULT_SHAPE && n.shape !== "rect") {
      if (!SHAPES[n.shape] && !ALIASES[n.shape] && !LEGACY[n.shape]) {
        unsupported.add(n.shape);
      }
    }

    const type = isGroup ? "container" : shape === AS_LABEL ? "label" : "box";
    const label = n.label ?? "";

    return {
      id: n.id,
      type,
      position,
      style: { width, height },
      data:
        type === "box"
          ? { shape: shape!, label }
          : collapsed
            ? { label, collapsed: true, members: membersOf.get(n.id) ?? [] }
            : { label },
      ...(n.parentId ? { parentId: n.parentId } : {}),
    };
  });

  const edges = (Array.isArray(layout.edges) ? layout.edges : []).map((e): OrdoEdge => {
    const stroke = strokeOf(e);
    const [sourceHandle, targetHandle] = handlesFor(
      centre.get(e.start),
      centre.get(e.end),
      layout.direction,
    );

    const base = {
      id: e.id,
      // Mermaid's edges always name both ends; its type leaves them optional.
      source: e.start!,
      target: e.end!,
      sourceHandle,
      targetHandle,
      data: { label: e.label ?? "" },
      // `~~~` is a layout hint with no ink. Keeping it hidden preserves the
      // relationship without drawing a line that was never meant to be seen.
      ...(stroke.invisible ? { hidden: true } : {}),
    };

    return applyEdgeStyle(base, {
      ...DEFAULT_EDGE_STYLE,
      route: ROUTE_BY_CURVE[e.curve ?? ""] ?? DEFAULT_EDGE_STYLE.route,
      dash: stroke.dash,
      strokeWidth: stroke.strokeWidth,
      markerStart: marker(e.arrowTypeStart),
      // `type` is the fallback for an edge that never went through
      // destructEdgeType and so carries no arrowType fields.
      markerEnd: marker(e.arrowTypeEnd ?? e.type),
    });
  });

  return { nodes: sortParentsFirst(nodes), edges, unsupported: [...unsupported] };
}

export default toOrdo;
