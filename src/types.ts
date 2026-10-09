import type { Edge, Node } from "@xyflow/react";
import type { TextWeight } from "./ordo/types.ts";

// The document model: what a node and an edge carry, in one place.
//
// Six node types share ONE data record rather than one record each. Most of
// the code that touches a node — history, the clipboard, the importers, the
// group wrapper — handles every type the same way and reaches for whichever
// fields are there (`attach`, `label`, `isDropTarget`), so the fields are all
// optional and each is written down once, beside the types that use it.

export type XY = { x: number; y: number };
export type Rect = XY & { width: number; height: number };
export type Size = [width: number, height: number];

/**
 * A rider's place on the edge it rides (see edges/attach.ts): a fraction `t`
 * along the path, never a point. `angle` is the edge's tangent there, kept
 * current by TubeFollower; `shift` sets it off to one side, in px.
 */
export type Attach = {
  edgeId: string;
  t: number;
  angle?: number;
  shift?: number;
};

export type NodeData = {
  // box, container, compartment, label
  label?: string;
  // …and its own size and weight, when not the kind's (see textStyle.ts)
  textSize?: number;
  textWeight?: TextWeight;
  // box: the registry key it is drawn with
  shape?: string;

  // tube (see nodes/tube.ts)
  slots?: number;
  taps?: number[];
  variant?: "track";
  attach?: Attach;
  rotation?: number;
  align?: boolean;

  // fragment (see nodes/fragment.ts)
  operator?: string;
  guards?: string[];
  dividers?: number[];
  fill?: string;

  // compartment
  sections?: string[][];

  // container: the drop highlight a drag paints on it, never content…
  isDropTarget?: boolean;
  // …a subgraph Mermaid sent collapsed, and what it held…
  collapsed?: boolean;
  members?: string[];
  // …and the diagram type an imported group came from, as Mermaid detected it.
  mermaid?: string | null;

  // A box's other label slots, by slot name (see ops.ts).
  [slot: string]: unknown;
};

// React Flow lets a node's style size be any CSS length. Every size here is
// written by the editor itself, in px, and read back as arithmetic.
export type OrdoNode = Node<NodeData> & {
  style?: { width?: number; height?: number };
};

// A node with its size set on it, as everything the sequence layout emits is.
export type SizedNode = OrdoNode & { style: { width: number; height: number } };

// Where an edge's label sits against the point its router hands back; see
// OrdoEdge.
export type LabelPlacement = "center" | "above" | "right";

export type EdgeData = {
  label?: string;
  textSize?: number;
  textWeight?: TextWeight;
  markerStart?: string;
  markerEnd?: string;
  labelPlacement?: LabelPlacement;
};

export type OrdoEdge = Edge<EdgeData>;

export type Graph = { nodes: OrdoNode[]; edges: OrdoEdge[] };
