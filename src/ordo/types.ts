// The Ordo file format, v1: what the two files hold, the resolved model the
// converters work on, and the diagnostics every stage reports in.
//
// File types mirror the YAML exactly. The resolved types are what you get once
// defaults are applied and the skeleton is flattened; nothing downstream of the
// reader ever looks at a file type again.
//
// The format can say everything the editor can put on its canvas: every node
// kind the palette offers, every route, line, colour and marker an edge can
// carry. Structure and content live in <name>.yml; where things are — and so
// everything a drag changes — lives in <name>.layout.yml.

// ---------- Vocabularies ----------

/** What a node is. A group is any one-key map in the skeleton; every other kind is a leaf. */
export const NODE_KINDS = ["box", "group", "text", "class", "tube", "fragment"] as const;
export type OrdoKind = (typeof NODE_KINDS)[number];
export type LeafKind = Exclude<OrdoKind, "group">;
export const LEAF_KINDS = NODE_KINDS.filter((k): k is LeafKind => k !== "group");

/** How an edge is routed between its ends. */
export const EDGE_ROUTES = ["step", "straight", "orthogonal", "curved"] as const;
export type OrdoRoute = (typeof EDGE_ROUTES)[number];

export const LINES = ["solid", "dotted", "dashed", "thick"] as const;
export type OrdoLine = (typeof LINES)[number];

/** End markers: flowchart, UML and ER cardinality. `arrow` is the filled head every flowchart edge ends in. */
export const MARKERS = [
  "none",
  "arrow",
  "open-arrow",
  "circle",
  "cross",
  "inheritance",
  "composition",
  "aggregation",
  "dependency",
  "er-one",
  "er-many",
  "er-zero-one",
  "er-zero-many",
  "er-one-many",
] as const;
export type OrdoMarker = (typeof MARKERS)[number];

/** Where an edge's label sits against its line. */
export const PLACEMENTS = ["center", "above", "right"] as const;
export type OrdoPlacement = (typeof PLACEMENTS)[number];

// ---------- <name>.yml : structure and content ----------

/** Stable key for a node or edge. Never derived from a label, never rewritten by the canvas. */
export type OrdoId = string;

/** A bare id is a leaf node. A one-key map is a group: its value lists the group's children. */
export type OrdoSkeletonItem = OrdoId | { [groupId: string]: OrdoSkeletonItem[] };

export interface OrdoNodeData {
  kind?: LeafKind; // default: box. A group is a group because the skeleton says so
  label?: string; // default: the node id (a tube or fragment has no label unless given one)
  shape?: string; // box only; default: DEFAULTS.shape
  type?: string; // semantic type, e.g. "store/postgres"; carried through, no rendering effect

  // group
  collapsed?: boolean; // a subgraph Mermaid sent collapsed…
  members?: string[]; // …and what it held
  mermaid?: string; // the Mermaid diagram type the group was imported from

  // class
  sections?: string[][]; // compartments, each a list of rows

  // tube
  slots?: number; // taps spread evenly…
  taps?: number[]; // …or pinned, each a distance from the head in px
  variant?: "track"; // a tube that draws nothing, carrying taps along a lifeline
  attach?: OrdoId; // the edge it rides; where along it is layout (t, shift, angle)
  align?: boolean; // false: do not turn with the edge it rides

  // fragment
  operator?: string; // loop, alt, opt, par, critical, break, rect, box…
  guards?: string[]; // one per operand
  dividers?: number[]; // operand dividers, px from the top
  fill?: string; // background colour
}

export interface OrdoEdgeData {
  label?: string; // default: no label
  line?: OrdoLine; // default: solid
  width?: number; // default: the line's own (3 for thick, else 1.5)
  color?: string; // default: DEFAULTS.color
  start?: OrdoMarker; // default: none
  end?: OrdoMarker; // default: arrow
  route?: OrdoRoute; // default: step
  placement?: OrdoPlacement; // default: center
  hidden?: boolean; // default: false — a layout-only link, such as Mermaid's ~~~
}

export interface OrdoEdge {
  id: OrdoId;
  from: OrdoId;
  to: OrdoId;
}

export interface OrdoFile {
  ordo: 1;
  nodes: OrdoSkeletonItem[];
  edges?: OrdoEdge[];
  data?: {
    nodes?: Record<OrdoId, OrdoNodeData>;
    edges?: Record<OrdoId, OrdoEdgeData>;
  };
}

// ---------- <name>.layout.yml : geometry only ----------

/** Top-left corner in px, relative to the parent group (or the canvas for root nodes). Integers. */
export interface OrdoBox {
  x: number;
  y: number;
  w?: number; // present only when the size is authored (always present for groups)
  h?: number;
  z?: number; // stacking order, when it is not the kind's own
  rotation?: number; // a tube's turn, in degrees
  t?: number; // an attached tube: how far along its edge, 0..1
  shift?: number; // …set off to one side, px
  angle?: number; // …and the edge's tangent there, degrees
}

/** React Flow handle ids an edge attaches to, and its stacking order. Omitted when there is nothing to say. */
export interface OrdoHandles {
  from?: string;
  to?: string;
  z?: number;
}

export interface OrdoLayoutFile {
  "ordo-layout": 1;
  nodes?: Record<OrdoId, OrdoBox>;
  edges?: Record<OrdoId, OrdoHandles>;
}

// ---------- Resolved model: defaults applied, tree flattened. Converters work on this. ----------

/** The fields a node carries beyond its identity, exactly as in the file (no defaults: present or absent). */
export type NodeFields = Pick<
  OrdoNodeData,
  | "collapsed"
  | "members"
  | "mermaid"
  | "sections"
  | "slots"
  | "taps"
  | "variant"
  | "attach"
  | "align"
  | "operator"
  | "guards"
  | "dividers"
  | "fill"
>;

export interface ResolvedNode extends NodeFields {
  id: OrdoId;
  parent: OrdoId | null;
  isGroup: boolean;
  kind?: OrdoKind; // default: group or box
  label?: string; // the id for kinds that show a label; absent for a tube or fragment without one
  shape: string; // meaningful for a box; DEFAULTS.shape otherwise
  type?: string;
}

export interface ResolvedEdge {
  id: OrdoId;
  from: OrdoId;
  to: OrdoId;
  label?: string;
  line: OrdoLine;
  width?: number; // only when it is not the line's own
  color?: string; // default DEFAULTS.color
  start: OrdoMarker;
  end: OrdoMarker;
  route?: OrdoRoute; // default step
  placement?: OrdoPlacement; // default center
  hidden?: boolean; // default false
}

export interface ResolvedDiagram {
  nodes: ResolvedNode[]; // pre-order: every parent before its children
  edges: ResolvedEdge[];
}

// ---------- Diagnostics: shared by the validator, the importer, the exporter and the MCP ----------

export type DiagnosticCode =
  | "yaml-syntax"
  | "schema"
  | "duplicate-id"
  | "unknown-endpoint"
  | "unknown-edge"
  | "orphan-data"
  | "group-shape"
  | "kind-field"
  | "unknown-shape"
  | "layout-orphan"
  | "canvas-unsupported"
  | "canvas-bad-id"
  | "canvas-lossy"
  | "canvas-bad-parent"
  | "canvas-dangling-edge";

export interface Diagnostic {
  severity: "error" | "warning";
  code: DiagnosticCode;
  message: string;
  file: "ordo" | "layout" | "canvas";
  path?: (string | number)[];
  line?: number; // 1-based
  col?: number; // 1-based
}

export const DEFAULTS = {
  kind: "box",
  shape: "rect",
  line: "solid",
  color: "#0f172a",
  start: "none",
  end: "arrow",
  route: "step",
  placement: "center",
} as const satisfies {
  kind: LeafKind;
  shape: string;
  line: OrdoLine;
  color: string;
  start: OrdoMarker;
  end: OrdoMarker;
  route: OrdoRoute;
  placement: OrdoPlacement;
};

/** The stroke width a line has unless the file says otherwise. */
export const lineWidth = (line: OrdoLine) => (line === "thick" ? 3 : 1.5);

/** Kinds that show a label, and so default it to the node's id. */
export const LABELLED: ReadonlySet<OrdoKind> = new Set(["box", "group", "text", "class"]);

/** The data fields each kind may carry, beyond label and type (which every kind may). */
export const KIND_FIELDS: Record<OrdoKind, readonly (keyof OrdoNodeData)[]> = {
  box: ["kind", "shape"],
  group: ["collapsed", "members", "mermaid"],
  text: ["kind"],
  class: ["kind", "sections"],
  tube: ["kind", "slots", "taps", "variant", "attach", "align"],
  fragment: ["kind", "operator", "guards", "dividers", "fill"],
};

/** Every node field a kind can carry, in canonical order — the order the writer puts them in. */
export const NODE_FIELD_ORDER = [
  "kind",
  "label",
  "shape",
  "type",
  "collapsed",
  "members",
  "mermaid",
  "sections",
  "slots",
  "taps",
  "variant",
  "attach",
  "align",
  "operator",
  "guards",
  "dividers",
  "fill",
] as const satisfies readonly (keyof OrdoNodeData)[];

export const EDGE_FIELD_ORDER = [
  "label",
  "line",
  "width",
  "color",
  "start",
  "end",
  "route",
  "placement",
  "hidden",
] as const satisfies readonly (keyof OrdoEdgeData)[];

/**
 * Any non-empty string with no control characters and no space at either end.
 * An id is whatever the canvas already uses — `n12`, a Mermaid `mermaid-1/A`,
 * a sequence `seq:head:App` — and the writer quotes whatever YAML would
 * misread, so `true` and `42` stay strings.
 */
export const ID_PATTERN = /^[^\s\u0000-\u001f\u007f]([^\u0000-\u001f\u007f]*[^\s\u0000-\u001f\u007f])?$/;
