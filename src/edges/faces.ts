import { Position } from "@xyflow/react";
import type { XY } from "../types.ts";

// Which face of a node an edge leaves from and arrives at, when nothing says.
//
// Every anchor on a node is declared `type="source"` (the canvas runs in loose
// connection mode), so React Flow cannot infer a side: left undefined it grabs
// the first handle it finds — "n" — at BOTH ends, and every edge leaves the top
// and arrives at the top. Two kinds of edge reach the canvas without a side.
// Mermaid's never do carry one: it sends no port information, so its importer
// picks the faces when it builds the edge (mermaid/toOrdo.ts). An .ordo file
// pins only the handles someone chose, and leaves an edge on its default
// handles unpinned on purpose, so OrdoEdge picks those faces as it draws.
// Both ask the one rule below, so the two cannot drift apart.
//
// Pure: no React, no store. OrdoEdge hands in what React Flow measured.

/** The four compass anchors every box, group, class and text node carries (nodes/chrome.tsx). */
export type Face = "n" | "e" | "s" | "w";

// A Mermaid flowchart's direction, as the pair of faces it implies.
const BY_DIRECTION: Record<string, [source: Face, target: Face]> = {
  TB: ["s", "n"],
  TD: ["s", "n"],
  BT: ["n", "s"],
  LR: ["e", "w"],
  RL: ["w", "e"],
};

/**
 * The faces an edge between two node centres should use. The dominant axis
 * between the centres decides the pair, so a back-edge or a sideways hop
 * anchors sensibly instead of following the diagram direction off the wrong
 * face; a tie goes to the vertical. `direction` (a flowchart's TB, LR …) is
 * only the fallback for a missing or coincident centre, and is top-down when
 * there is none.
 */
export function handlesFor(
  from: XY | undefined,
  to: XY | undefined,
  direction?: string,
): [source: Face, target: Face] {
  const fallback = Object.hasOwn(BY_DIRECTION, direction ?? "")
    ? BY_DIRECTION[direction!]
    : BY_DIRECTION.TB;
  if (!from || !to) return fallback;

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === 0) return fallback;

  if (Math.abs(dy) >= Math.abs(dx)) return dy >= 0 ? ["s", "n"] : ["n", "s"];
  return dx >= 0 ? ["e", "w"] : ["w", "e"];
}

/** A handle's box relative to its node's top-left, as React Flow measures it into internals.handleBounds. */
export type HandleBox = {
  id?: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  position: Position;
};

/** What choosing an end needs to know about a node: its absolute box and its handles. */
export type NodeBox = {
  x: number;
  y: number;
  width: number;
  height: number;
  handles: readonly HandleBox[];
};

/** One end of an edge, as React Flow hands it to an edge component. */
export type EdgeEnd = { x: number; y: number; position: Position };

/**
 * The structural slice of a React Flow InternalNode this module reads, so it
 * can be fed a plain object in tests. The size is React Flow's own fallback
 * chain (measured, then the node's width and height).
 */
export type MeasuredNode = {
  internals: {
    positionAbsolute: XY;
    handleBounds?: {
      source?: readonly HandleBox[] | null;
      target?: readonly HandleBox[] | null;
    } | null;
  };
  measured?: { width?: number; height?: number };
  width?: number | null;
  height?: number | null;
};

export function nodeBox(node: MeasuredNode | undefined): NodeBox | undefined {
  if (!node) return undefined;
  const bounds = node.internals.handleBounds;
  return {
    x: node.internals.positionAbsolute.x,
    y: node.internals.positionAbsolute.y,
    width: node.measured?.width ?? node.width ?? 0,
    height: node.measured?.height ?? node.height ?? 0,
    handles: [...(bounds?.source ?? []), ...(bounds?.target ?? [])],
  };
}

const centreOf = (n: NodeBox): XY => ({
  x: n.x + n.width / 2,
  y: n.y + n.height / 2,
});

/**
 * Where an edge meets `handle`, worked out as React Flow works it out for an
 * edge that names the handle (getHandlePosition in @xyflow/system): the middle
 * of the handle box's outer side. So an end on a default handle lands exactly
 * where it would if the file had pinned the same face.
 */
export function anchorPoint(node: NodeBox, handle: HandleBox): EdgeEnd {
  const x = node.x + handle.x;
  const y = node.y + handle.y;
  const { width, height, position } = handle;
  switch (position) {
    case Position.Top:
      return { x: x + width / 2, y, position };
    case Position.Right:
      return { x: x + width, y: y + height / 2, position };
    case Position.Bottom:
      return { x: x + width / 2, y: y + height, position };
    default:
      return { x, y: y + height / 2, position: Position.Left };
  }
}

/**
 * Where each end of an edge goes when it names no handle: the anchor on the
 * face handlesFor picks from the two node centres. An end that names its
 * handle is React Flow's to place, and so is an end whose node has no anchor on
 * that face (a tube, say), so nothing that drew correctly before moves; each
 * appears here only when it is overridden.
 */
export function defaultEnds(
  source: NodeBox | undefined,
  target: NodeBox | undefined,
  pinned: { source: boolean; target: boolean },
): { source?: EdgeEnd; target?: EdgeEnd } {
  if ((pinned.source && pinned.target) || !source || !target) return {};
  const [from, to] = handlesFor(centreOf(source), centreOf(target));
  const at = (node: NodeBox, face: Face) => {
    const handle = node.handles.find((h) => h.id === face);
    return handle ? anchorPoint(node, handle) : undefined;
  };
  const s = pinned.source ? undefined : at(source, from);
  const t = pinned.target ? undefined : at(target, to);
  return { ...(s ? { source: s } : {}), ...(t ? { target: t } : {}) };
}
