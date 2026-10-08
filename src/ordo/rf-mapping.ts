import type { Connection, Edge, Node } from "@xyflow/react";
import { SHAPES as REGISTRY, defaultSize } from "../shapes/registry.ts";
import { SHAPE_ALIASES } from "../shapes/aliases.ts";
import { LINE_TYPES, applyEdgeStyle, newEdge } from "../edgeStyle.ts";
import type { EdgeStyle } from "../edgeStyle.ts";
import { NODE_TYPE_DEFAULTS } from "../nodes/defaults.ts";
import { TUBE_TYPE } from "../nodes/tube.ts";
import { FRAGMENT_TYPE } from "../nodes/fragment.ts";
import type { NodeData, OrdoEdge, OrdoNode } from "../types.ts";
import {
  DEFAULTS,
  EDGE_ROUTES,
  PLACEMENTS,
  lineWidth,
  type NodeFields,
  type OrdoBox,
  type OrdoHandles,
  type OrdoKind,
  type OrdoLine,
  type OrdoMarker,
  type OrdoPlacement,
  type OrdoRoute,
  type ResolvedEdge,
  type ResolvedNode,
} from "./types.ts";

// The one module that knows how this editor spells things on the canvas.
// Nothing else in src/ordo may know a React Flow convention: the reader and
// writer speak the file format, the converters speak the resolved model, and
// every crossing between the model and the canvas goes through here.
//
// Every node and edge the editor can make has a spelling in the format, so
// nothing the editor draws is ever refused:
//
//   node kind     box ↔ box, group ↔ container, text ↔ label,
//                 class ↔ compartment, tube ↔ tube, fragment ↔ fragment
//   size          style.width / style.height, where the editor puts it. A
//                 resize makes React Flow write width/height on the node
//                 itself, and those win (it draws node.width ?? style)
//   kind defaults NODE_TYPE_DEFAULTS (nodes/defaults.ts) and the shape
//                 registry: a size, a style, a zIndex the palette gives every
//                 node of the kind, and so need not be written down
//   tube riding   data.attach = { edgeId, t, shift, angle }: the edge is
//                 structure (.ordo `attach`), the rest is where it sits (layout)
//   edge route    edge.type (edges/routers.ts)
//   edge label    data.label, "" for none; data.labelPlacement
//   markers       data.markerStart / data.markerEnd, edges/markers.tsx keys
//   line          style: stroke colour, width and a dash pattern
//   handles       the compass anchors n, e, s, w (nodes/chrome.tsx), named
//                 top, right, bottom, left in files; a tube's taps by their ids
//
// The editor keeps no field that is derived from another one, so an edit
// cannot leave a stale twin behind. Whatever the canvas holds is read back
// through readNode/readEdge, rebuilt through rfNode/rfEdge, and compared; only
// something the editor itself never makes can fail that (from-react-flow.ts).

// ---------------------------------------------------------------------------
// Kinds
// ---------------------------------------------------------------------------

const TYPE_OF_KIND: Record<OrdoKind, string> = {
  box: "box",
  group: "container",
  text: "label",
  class: "compartment",
  tube: TUBE_TYPE,
  fragment: FRAGMENT_TYPE,
};
const KIND_OF_TYPE: Record<string, OrdoKind> = Object.fromEntries(
  Object.entries(TYPE_OF_KIND).map(([kind, type]) => [type, kind as OrdoKind]),
);

export const GROUP_TYPE = TYPE_OF_KIND.group;

/** The kind a canvas node type stands for, or undefined for a type the editor does not have. */
export const kindOfType = (type: string | undefined): OrdoKind | undefined =>
  type !== undefined && Object.hasOwn(KIND_OF_TYPE, type) ? KIND_OF_TYPE[type] : undefined;

/** The palette's defaults for a kind: its size, style and stacking. A box takes its size from its shape. */
const kindDefaults = (kind: OrdoKind) => (kind === "box" ? undefined : NODE_TYPE_DEFAULTS[TYPE_OF_KIND[kind]]);

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/**
 * The registry key a shape name stands for, or undefined for a name the
 * editor cannot draw. A file may use a registry key or any documented alias
 * (`cylinder`, `database` and `cyl` are one shape); the canvas only ever holds
 * the key, and a resolved diagram only ever carries the key.
 */
export function canonicalShape(name: string): string | undefined {
  if (Object.hasOwn(REGISTRY, name)) return name;
  const key = Object.hasOwn(SHAPE_ALIASES, name) ? SHAPE_ALIASES[name] : undefined;
  return key !== undefined && Object.hasOwn(REGISTRY, key) ? key : undefined;
}

/**
 * Every shape name a file may use: the registry's keys and their aliases.
 * Built on each call, so a shape added through registerShape is included.
 */
export function shapeVocabulary(): ReadonlySet<string> {
  const names = new Set(Object.keys(REGISTRY));
  for (const alias of Object.keys(SHAPE_ALIASES)) if (canonicalShape(alias)) names.add(alias);
  return names;
}

// ---------------------------------------------------------------------------
// Sizes
// ---------------------------------------------------------------------------

// The same frame mermaid/group.ts puts around an imported diagram: room for
// the title band, and a border's width of air on every side.
export const GROUP_PAD = 24;
export const GROUP_HEADER = 32;

// A group with nothing in it and no authored size, at the size the palette
// drops one.
export const EMPTY_GROUP_SIZE = {
  w: NODE_TYPE_DEFAULTS.container.size[0],
  h: NODE_TYPE_DEFAULTS.container.size[1],
} as const;

/** A box's size when the layout gives none: its shape's registry default, the size the palette drops it at. */
export function leafSize(shape: string): { w: number; h: number } {
  const [w, h] = defaultSize(shape);
  return { w, h };
}

/**
 * A node's size when the layout file gives none: the size the palette drops
 * its kind at. These nodes have no intrinsic size for React Flow to measure,
 * so this is the size they draw at — and a size equal to it is never written.
 */
export function kindSize(kind: OrdoKind, shape: string): { w: number; h: number } {
  if (kind === "group") return EMPTY_GROUP_SIZE;
  const spec = kindDefaults(kind);
  return spec ? { w: spec.size[0], h: spec.size[1] } : leafSize(shape);
}

// ---------------------------------------------------------------------------
// Handles, markers and lines
// ---------------------------------------------------------------------------

// Files name the four sides; the canvas names the anchors after the compass.
// Anything else (a tube's taps) passes through untouched in both directions.
const HANDLE_IDS: Record<string, string> = { top: "n", right: "e", bottom: "s", left: "w" };
const HANDLE_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(HANDLE_IDS).map(([name, id]) => [id, name]),
);

export const toRfHandle = (name: string) => (Object.hasOwn(HANDLE_IDS, name) ? HANDLE_IDS[name] : name);
export const toOrdoHandle = (id: string) => (Object.hasOwn(HANDLE_NAMES, id) ? HANDLE_NAMES[id] : id);

// Ordo's `arrow` is the filled head every flowchart edge ends in (what the
// Mermaid importer maps `arrow_point` to), so the editor's open `arrow` is
// `open-arrow` in a file. Every other marker is spelled the same.
const MARKER_KEYS: Record<OrdoMarker, string> = {
  none: "none",
  arrow: "arrow-filled",
  "open-arrow": "arrow",
  circle: "circle",
  cross: "cross",
  inheritance: "inheritance",
  composition: "composition",
  aggregation: "aggregation",
  dependency: "dependency",
  "er-one": "er-one",
  "er-many": "er-many",
  "er-zero-one": "er-zero-one",
  "er-zero-many": "er-zero-many",
  "er-one-many": "er-one-many",
};
const ORDO_MARKERS: Record<string, OrdoMarker> = Object.fromEntries(
  Object.entries(MARKER_KEYS).map(([marker, key]) => [key, marker as OrdoMarker]),
);

/** The editor's marker key for an Ordo marker, and back. */
export const markerKey = (marker: OrdoMarker) => MARKER_KEYS[marker];
export const markerOf = (key: string) => (Object.hasOwn(ORDO_MARKERS, key) ? ORDO_MARKERS[key] : undefined);

// The toolbar's dash patterns (edgeStyle.ts LINE_TYPES); a thick line is solid.
const dashOf = (key: string, fallback: string) => LINE_TYPES.find((t) => t.key === key)?.dash ?? fallback;
const DASHES: Record<OrdoLine, string> = {
  solid: "",
  thick: "",
  dotted: dashOf("dotted", "1 5"),
  dashed: dashOf("dashed", "8 4"),
};

// ---------------------------------------------------------------------------
// Model -> canvas
// ---------------------------------------------------------------------------

/** The fields a node carries as they are, between the file and node.data. `attach` is rebuilt, not copied. */
const CARRIED = [
  "collapsed",
  "members",
  "mermaid",
  "sections",
  "slots",
  "taps",
  "variant",
  "align",
  "operator",
  "guards",
  "dividers",
  "fill",
] as const satisfies readonly (keyof NodeFields)[];

const kindOf = (n: Pick<ResolvedNode, "kind" | "isGroup">): OrdoKind => n.kind ?? (n.isGroup ? "group" : DEFAULTS.kind);

/** The one way to build an Ordo-backed node. Import uses it; the palette's makeNode builds the same object. */
export function rfNode(n: ResolvedNode, box: OrdoBox): OrdoNode {
  const kind = kindOf(n);
  const spec = kindDefaults(kind);
  const size = box.w !== undefined && box.h !== undefined ? { w: box.w, h: box.h } : kindSize(kind, n.shape);

  const data: NodeData = {};
  if (kind === "box") data.shape = n.shape;
  if (n.label !== undefined) data.label = n.label;
  if (n.type !== undefined) data.semanticType = n.type;
  for (const f of CARRIED) if (n[f] !== undefined) (data as Record<string, unknown>)[f] = structuredClone(n[f]);
  if (n.attach !== undefined)
    data.attach = {
      edgeId: n.attach,
      t: box.t ?? 0.5,
      ...(box.angle !== undefined ? { angle: box.angle } : {}),
      ...(box.shift !== undefined ? { shift: box.shift } : {}),
    };
  if (box.rotation !== undefined) data.rotation = box.rotation;

  const z = box.z ?? spec?.zIndex;
  return {
    id: n.id,
    type: TYPE_OF_KIND[kind],
    position: { x: box.x, y: box.y },
    style: { width: size.w, height: size.h, ...spec?.style },
    data,
    ...(z !== undefined ? { zIndex: z } : {}),
    ...(n.parent !== null ? { parentId: n.parent } : {}),
  };
}

/** The one way to build an Ordo-backed edge. Import uses it, and so does onConnect (connectionEdge). */
export function rfEdge(e: ResolvedEdge, handles?: OrdoHandles): OrdoEdge {
  const placement = e.placement ?? DEFAULTS.placement;
  const base = {
    id: e.id,
    source: e.from,
    target: e.to,
    ...(handles?.from !== undefined ? { sourceHandle: toRfHandle(handles.from) } : {}),
    ...(handles?.to !== undefined ? { targetHandle: toRfHandle(handles.to) } : {}),
    data: { label: e.label ?? "", ...(placement !== "center" ? { labelPlacement: placement } : {}) },
    ...(e.hidden ? { hidden: true } : {}),
    ...(handles?.z !== undefined ? { zIndex: handles.z } : {}),
  };
  return applyEdgeStyle(base, {
    stroke: e.color ?? DEFAULTS.color,
    strokeWidth: e.width ?? lineWidth(e.line),
    dash: DASHES[e.line],
    markerStart: MARKER_KEYS[e.start],
    markerEnd: MARKER_KEYS[e.end],
    route: e.route ?? DEFAULTS.route,
  });
}

// ---------------------------------------------------------------------------
// Canvas -> model
// ---------------------------------------------------------------------------

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const record = (v: unknown): Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/**
 * What a canvas node says, in the model's terms, unchecked: fromReactFlow
 * decides whether each value can be stored, and the rebuild-and-compare there
 * catches anything that would not come back the same.
 */
export function readNode(n: Node): {
  kind: OrdoKind | undefined;
  label: unknown;
  shape: unknown;
  type: unknown;
  fields: Record<string, unknown>;
  attach: Record<string, unknown> | undefined;
} {
  const d = record(n.data);
  const fields: Record<string, unknown> = {};
  for (const f of CARRIED) if (d[f] !== undefined && d[f] !== null) fields[f] = structuredClone(d[f]);
  const attach = d.attach !== undefined && d.attach !== null ? record(d.attach) : undefined;
  return { kind: kindOfType(n.type), label: d.label, shape: d.shape, type: d.semanticType, fields, attach };
}

/** Where a node sits beyond x/y/w/h: its stacking, its turn, and how it rides an edge. */
export function readGeometry(n: Node): Pick<OrdoBox, "z" | "rotation" | "t" | "shift" | "angle"> {
  const kind = kindOfType(n.type);
  const d = record(n.data);
  const attach = record(d.attach);
  const z = num(n.zIndex);
  const out: Pick<OrdoBox, "z" | "rotation" | "t" | "shift" | "angle"> = {};
  if (z !== undefined && (kind === undefined || z !== kindDefaults(kind)?.zIndex)) out.z = z;
  if (num(d.rotation) !== undefined) out.rotation = num(d.rotation);
  if (num(attach.t) !== undefined) out.t = num(attach.t);
  if (num(attach.shift) !== undefined) out.shift = num(attach.shift);
  if (num(attach.angle) !== undefined) out.angle = num(attach.angle);
  return out;
}

/**
 * What a canvas edge says, in the model's terms. A style the format has no
 * spelling for reads as the nearest one, and the rebuild-and-compare in
 * fromReactFlow then refuses it by name.
 */
export function readEdge(e: Edge): Omit<ResolvedEdge, "id" | "from" | "to" | "label"> & { label: unknown } {
  const d = record(e.data);
  const style = record(e.style);
  const dash = typeof style.strokeDasharray === "string" ? style.strokeDasharray : "";
  const strokeWidth = num(style.strokeWidth);
  const line: OrdoLine =
    dash === DASHES.dotted ? "dotted" : dash === DASHES.dashed ? "dashed" : dash === "" && strokeWidth === 3 ? "thick" : "solid";
  const marker = (key: unknown, fallback: OrdoMarker) => (typeof key === "string" ? markerOf(key) : undefined) ?? fallback;
  const route = (EDGE_ROUTES as readonly string[]).includes(String(e.type)) ? (e.type as OrdoRoute) : DEFAULTS.route;
  const placement = (PLACEMENTS as readonly string[]).includes(String(d.labelPlacement))
    ? (d.labelPlacement as OrdoPlacement)
    : DEFAULTS.placement;
  return {
    label: d.label,
    line,
    ...(strokeWidth !== undefined && strokeWidth !== lineWidth(line) ? { width: strokeWidth } : {}),
    color: typeof style.stroke === "string" ? style.stroke : DEFAULTS.color,
    start: marker(d.markerStart, DEFAULTS.start),
    end: marker(d.markerEnd, DEFAULTS.end),
    route,
    placement,
    hidden: e.hidden === true,
  };
}

/** Whether an edge's type is one of the editor's routes. */
export const isRoute = (type: string | undefined) => (EDGE_ROUTES as readonly string[]).includes(String(type));

/**
 * The size a node is drawn at, rounded as export rounds it: React Flow's own
 * width/height, which a resize writes, over the style size the editor creates
 * nodes with. A group with neither falls back to its measured size.
 */
export function drawnSize(n: Node): { w: number; h: number } | undefined {
  const style = record(n.style);
  let w = num(n.width) ?? num(style.width);
  let h = num(n.height) ?? num(style.height);
  if (n.type === GROUP_TYPE) {
    w ??= num(n.measured?.width);
    h ??= num(n.measured?.height);
  }
  return w !== undefined && h !== undefined ? { w: Math.round(w), h: Math.round(h) } : undefined;
}

/**
 * The size the layout file records: always a group's; any other node's only
 * when it differs from what its kind (or a box's shape) is dropped at, which is
 * what makes it authored.
 */
export function authoredSize(n: Node): { w: number; h: number } | undefined {
  const size = drawnSize(n);
  const kind = kindOfType(n.type);
  if (!size || kind === "group" || kind === undefined) return size;
  const { shape } = readNode(n);
  const fallback = kindSize(kind, typeof shape === "string" ? shape : DEFAULTS.shape);
  return size.w === fallback.w && size.h === fallback.h ? undefined : size;
}

/**
 * A canvas node as export sees it, for the lossless comparison: position and
 * size rounded the way they are written, the drawn size folded into `style`
 * where rfNode puts it, and the drop highlight a drag paints on a group (never
 * content, see App's markDropTargets) left out.
 */
export function canvasNode(n: Node): Record<string, unknown> {
  const { width: _width, height: _height, ...rest } = n;
  const out: Record<string, unknown> = {
    ...rest,
    position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
  };
  const size = drawnSize(n);
  if (size) out.style = { ...record(n.style), width: size.w, height: size.h };
  else if (n.width !== undefined || n.height !== undefined) {
    out.width = n.width;
    out.height = n.height;
  }
  const data = record(n.data);
  if (Object.hasOwn(data, "isDropTarget")) {
    const { isDropTarget: _flag, ...content } = data;
    out.data = content;
  }
  return out;
}

/**
 * The only fields React Flow writes onto nodes and edges by itself that are
 * not diagram data (applyChange in @xyflow/react 12.12): selection, drag
 * state, resize state and measured size. They describe this session, not the
 * diagram, so they are never stored. Every other field must survive export ->
 * import, or export refuses. (A resize's width/height and a drag's position
 * are diagram data; canvasNode folds them in.)
 */
export const RUNTIME_NODE_KEYS: ReadonlySet<string> = new Set(["selected", "dragging", "resizing", "measured"]);
export const RUNTIME_EDGE_KEYS: ReadonlySet<string> = new Set(["selected"]);

// ---------------------------------------------------------------------------
// Drawing by hand
// ---------------------------------------------------------------------------

/**
 * The Ordo fields a toolbar style stands for, or null when the format has no
 * spelling for it (a dash pattern the toolbar does not offer, say).
 */
export function ordoEdgeStyle(style: EdgeStyle): Omit<ResolvedEdge, "id" | "from" | "to" | "label"> | null {
  const probe = applyEdgeStyle({ id: "probe", source: "a", target: "b", data: { label: "" } }, style);
  const { label: _label, ...fields } = readEdge(probe);
  const back = rfEdge({ id: "probe", from: "a", to: "b", ...fields });
  const same = JSON.stringify([probe.type, probe.style, probe.data]) === JSON.stringify([back.type, back.style, back.data]);
  return same ? fields : null;
}

/**
 * An edge drawn by hand (onConnect), built by rfEdge from the toolbar's
 * current style, so it is Ordo-backed from birth. A style the format cannot
 * spell (none the toolbar offers) falls back to the editor's own newEdge.
 */
export function connectionEdge(connection: Connection, id: string, style: EdgeStyle): OrdoEdge {
  const fields = ordoEdgeStyle(style);
  if (!fields) return { ...newEdge(connection, style), id };
  const { source, target, sourceHandle, targetHandle } = connection;
  return rfEdge(
    { id, from: source, to: target, ...fields },
    {
      ...(sourceHandle ? { from: toOrdoHandle(sourceHandle) } : {}),
      ...(targetHandle ? { to: toOrdoHandle(targetHandle) } : {}),
    },
  );
}
