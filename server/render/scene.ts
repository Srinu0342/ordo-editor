import { Position } from "@xyflow/react";
import { importOrdo } from "../../src/ordo/index.ts";
import type { Diagnostic } from "../../src/ordo/index.ts";
import { anchorPoint, defaultEnds } from "../../src/edges/faces.ts";
import type { EdgeEnd, HandleBox, NodeBox } from "../../src/edges/faces.ts";
import { route } from "../../src/edges/routers.ts";
import { NODE_TYPE_DEFAULTS, TEXT_FONT, TEXT_PAD, TEXT_PLACEHOLDER, textSize } from "../../src/nodes/defaults.ts";
import { TUBE_SIZE, TUBE_TYPE, tapOffsets } from "../../src/nodes/tube.ts";
import { DEFAULT_SHAPE, defaultSize } from "../../src/shapes/registry.ts";
import { fontOf } from "../../src/textStyle.ts";
import type { NodeData, OrdoEdge, OrdoNode } from "../../src/types.ts";
import { pointAt, polyline } from "./path.ts";
import type { Pt } from "./path.ts";
import { classLayout, widthOf } from "./text.ts";

// Where everything sits, worked out the way the canvas works it out, with no
// DOM: the editor's own import gives the nodes and edges (auto layout
// included, so a node the file has no position for lands where the editor
// puts it), and what React Flow would measure in the browser — node sizes,
// handle boxes, an edge's path — is computed from the same numbers the node
// components draw with.

export type SceneNode = {
  id: string;
  type: string;
  data: NodeData;
  parentId?: string;
  x: number; // absolute top-left
  y: number;
  w: number; // the box React Flow measures
  h: number;
  drawH: number; // the height drawn: a class is as tall as its rows, whatever its box
  angle: number; // a tube's turn, in degrees
  z: number;
  index: number;
};

export type SceneEdge = {
  id: string;
  d: string;
  points: Pt[];
  labelX: number;
  labelY: number;
  data: OrdoEdge["data"];
  style: OrdoEdge["style"];
  z: number;
  index: number;
};

export type Scene = { nodes: SceneNode[]; edges: SceneEdge[] };

const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

// A handle is 6 px and a 1 px border, content-box (@xyflow/react's style.css).
const HANDLE_BOX = 8;
// The compass anchors (nodes/chrome.tsx), in the order they are mounted.
const COMPASS_IDS = ["n", "e", "s", "w"] as const;
// How far in from the node's edge they are centred: a handle is placed
// against its node's padding box, which is inside the border a group (1.5
// px), a class (1.5 px) or a text node (1 px) draws.
const FACE_INSET: Record<string, number> = { box: 0, container: 1.5, compartment: 1.5, label: 1 };

// TubeNode's: a tube riding an edge turns with it, from lying along it.
const ALONG = -90;
const norm = (deg: number) => ((((deg + 180) % 360) + 360) % 360) - 180;

/** The size React Flow measures a node at, and the height it is drawn at. */
function sizeOf(n: OrdoNode): { w: number; h: number; drawH: number } {
  const style = (n.style ?? {}) as Record<string, unknown>;
  if (n.type === "label") {
    // As big as its words, which React Flow measures in the browser: the
    // words' own width (textSize pads it for room), its padding and border,
    // and the 2 px EditableLabel keeps for the caret.
    const font = fontOf(TEXT_FONT, n.data);
    const [, h] = textSize(n.data.label ?? "", font);
    const words = Math.max(...(n.data.label || TEXT_PLACEHOLDER).split("\n").map((l) => widthOf(l, font)));
    return { w: Math.ceil(words) + 2 * (TEXT_PAD[1] + 1) + 2, h, drawH: h };
  }
  const [dw, dh] =
    n.type === TUBE_TYPE ? TUBE_SIZE : (NODE_TYPE_DEFAULTS[n.type ?? ""]?.size ?? defaultSize(n.data.shape ?? DEFAULT_SHAPE));
  const w = num(style.width, dw);
  const h = num(style.height, dh);
  if (n.type === "compartment") return { w, h, drawH: classLayout(n.data).height };
  return { w, h, drawH: h };
}

/**
 * A node's handles as React Flow measures them: an 8 px box (6 px and a 1 px
 * border) centred on the side it sits on, in the order they are in the DOM —
 * an edge that names no handle starts from the first. A tube turns its
 * handles with it.
 */
function handlesOf(n: SceneNode): HandleBox[] {
  const box = (id: string, cx: number, cy: number, position: Position): HandleBox => {
    let x = cx;
    let y = cy;
    let size = HANDLE_BOX;
    if (n.angle) {
      const rad = (n.angle * Math.PI) / 180;
      const [ox, oy] = [n.w / 2, n.h / 2];
      x = ox + (cx - ox) * Math.cos(rad) - (cy - oy) * Math.sin(rad);
      y = oy + (cx - ox) * Math.sin(rad) + (cy - oy) * Math.cos(rad);
      size = HANDLE_BOX * (Math.abs(Math.cos(rad)) + Math.abs(Math.sin(rad)));
    }
    return { id, x: x - size / 2, y: y - size / 2, width: size, height: size, position };
  };

  if (n.type === TUBE_TYPE) {
    const taps = tapOffsets(n.data, n.h);
    return [
      ...taps.flatMap((y, i) => [box(`a${i}`, 0, y, Position.Left), box(`b${i}`, n.w, y, Position.Right)]),
      box("head", n.w / 2, 0, Position.Top),
      box("tail", n.w / 2, n.h, Position.Bottom),
    ];
  }
  if (!Object.hasOwn(FACE_INSET, n.type)) return []; // a fragment has none
  const inset = FACE_INSET[n.type];
  const [w, h] = [n.w, n.drawH];
  const at: Record<string, [number, number, Position]> = {
    n: [w / 2, inset, Position.Top],
    e: [w - inset, h / 2, Position.Right],
    s: [w / 2, h - inset, Position.Bottom],
    w: [inset, h / 2, Position.Left],
  };
  return COMPASS_IDS.map((id) => box(id, ...at[id]));
}

const nodeBox = (n: SceneNode): NodeBox => ({ x: n.x, y: n.y, width: n.w, height: n.h, handles: handlesOf(n) });

/**
 * The two ends of an edge, as OrdoEdge draws it: a named handle where it
 * names one, and for an end that names none, the face that looks at the other
 * node (faces.ts), or React Flow's first handle where that face has no anchor.
 * Null when a named handle isn't there: React Flow draws no such edge.
 */
function endsOf(e: OrdoEdge, s: SceneNode, t: SceneNode): { source: EdgeEnd; target: EdgeEnd } | null {
  const [sb, tb] = [nodeBox(s), nodeBox(t)];
  const pick = (b: NodeBox, id: string | null | undefined) => (id == null ? b.handles[0] : b.handles.find((h) => h.id === id));
  const [sh, th] = [pick(sb, e.sourceHandle), pick(tb, e.targetHandle)];
  if (!sh || !th) return null;
  const chosen = defaultEnds(sb, tb, { source: e.sourceHandle != null, target: e.targetHandle != null });
  return { source: chosen.source ?? anchorPoint(sb, sh), target: chosen.target ?? anchorPoint(tb, th) };
}

export type SceneResult = { scene: Scene; diagnostics: Diagnostic[] } | { scene: null; diagnostics: Diagnostic[] };

export function buildScene(text: string): SceneResult {
  const read = importOrdo(text);
  if (read.diagnostics.some((d) => d.severity === "error") || !read.ordo) return { scene: null, diagnostics: read.diagnostics };

  // Nodes come parents-first, so a parent is placed before its children.
  const byId = new Map<string, SceneNode>();
  const nodes = read.nodes.map((n, index) => {
    const parent = n.parentId ? byId.get(n.parentId) : undefined;
    const { w, h, drawH } = sizeOf(n);
    const own = num(n.zIndex, 0);
    const z = parent ? (parent.z >= own ? parent.z + 1 : own) : own;
    const angle = n.type === TUBE_TYPE && !n.data.attach ? norm(n.data.rotation ?? 0) : 0;
    const node: SceneNode = {
      id: n.id,
      type: n.type ?? "box",
      data: n.data,
      ...(n.parentId ? { parentId: n.parentId } : {}),
      x: (parent?.x ?? 0) + n.position.x,
      y: (parent?.y ?? 0) + n.position.y,
      w,
      h,
      drawH,
      angle,
      z,
      index,
    };
    byId.set(n.id, node);
    return node;
  });

  const shown = read.edges.filter((e) => !e.hidden);
  const edgeById = new Map(shown.map((e) => [e.id, e]));

  const geometry = (e: OrdoEdge) => {
    const [s, t] = [byId.get(e.source), byId.get(e.target)];
    if (!s || !t) return null;
    const ends = endsOf(e, s, t);
    if (!ends) return null;
    const [d, labelX, labelY] = route(String(e.type), {
      sourceX: ends.source.x,
      sourceY: ends.source.y,
      sourcePosition: ends.source.position,
      targetX: ends.target.x,
      targetY: ends.target.y,
      targetPosition: ends.target.position,
    });
    return { d, labelX, labelY, s, t };
  };

  // A tube riding an edge sits where TubeFollower puts it: centred on the
  // point `t` of the way along, turned with the edge. Its edge may itself run
  // between riders, so they are placed in rounds until none is left that can
  // be; one whose edge isn't drawn keeps the place the file gave it.
  const riders = new Set(nodes.filter((n) => n.type === TUBE_TYPE && n.data.attach).map((n) => n.id));
  const isPlaced = (id: string) => !riders.has(id);
  for (let progress = true; riders.size && progress; ) {
    progress = false;
    for (const id of [...riders]) {
      const n = byId.get(id)!;
      const attach = n.data.attach!;
      const edge = edgeById.get(attach.edgeId);
      if (edge && !(isPlaced(edge.source) && isPlaced(edge.target))) continue;
      riders.delete(id);
      progress = true;
      const g = edge ? geometry(edge) : null;
      const at = g ? pointAt(polyline(g.d), attach.t) : null;
      if (!at) {
        n.angle = norm(n.data.rotation ?? 0);
        continue;
      }
      const rad = (at.angle * Math.PI) / 180;
      const shift = attach.shift ?? 0;
      n.x = at.x - n.w / 2 + shift * Math.sin(rad);
      n.y = at.y - n.h / 2 - shift * Math.cos(rad);
      n.angle = norm((n.data.align !== false ? at.angle + ALONG : 0) + (n.data.rotation ?? 0));
    }
  }

  const edges: SceneEdge[] = [];
  shown.forEach((e, index) => {
    const g = geometry(e);
    if (!g) return;
    // Below the nodes, except an edge between children of a group, which is
    // lifted to their level (getElevatedEdgeZIndex in @xyflow/system).
    const z = num(e.zIndex, 0) + Math.max(g.s.parentId ? g.s.z : 0, g.t.parentId ? g.t.z : 0);
    edges.push({ id: e.id, d: g.d, points: polyline(g.d), labelX: g.labelX, labelY: g.labelY, data: e.data, style: e.style, z, index });
  });

  return { scene: { nodes, edges }, diagnostics: read.diagnostics };
}
