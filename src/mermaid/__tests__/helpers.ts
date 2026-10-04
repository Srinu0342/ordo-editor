// Reading geometry back out of an import, the way the canvas will draw it.

import type { OrdoEdge, OrdoNode, SizedNode } from "../../types.ts";
import type { Span } from "../sequence.ts";

export const index = <N extends OrdoNode>(nodes: N[]) =>
  new Map(nodes.map((n) => [n.id, n]));

// The absolute y a handle sits at: a tube's pinned tap, or a box's side
// anchor, which is centred on its height.
// `handle` as React Flow types an edge's: an edge may name none.
export function handleY(
  byId: Map<string, SizedNode>,
  nodeId: string,
  handle: string | null | undefined,
) {
  const node = byId.get(nodeId)!;
  if (node.type === "tube")
    return node.position.y + node.data.taps![Number(handle!.slice(1))];
  return node.position.y + node.style.height / 2;
}

export const messages = (edges: OrdoEdge[]) =>
  edges.filter((e) => e.id.startsWith("seq:msg:"));

export const streamIdxOf = (edge: OrdoEdge) => Number(edge.id.slice("seq:msg:".length));

// Where TubeFollower will centre a rider: `t` along the straight path from
// its header's bottom handle to its foot's top handle, each 3px outside the
// box.
export function riderCentre(byId: Map<string, SizedNode>, tube: OrdoNode) {
  const attach = tube.data.attach!;
  const actor = attach.edgeId.slice("seq:life:".length);
  const head = byId.get(`seq:head:${actor}`)!;
  const foot = byId.get(`seq:foot:${actor}`)!;
  const from = head.position.y + head.style.height + 3;
  const to = foot.position.y - 3;
  return {
    x: head.position.x + head.style.width / 2 + (attach.shift ?? 0),
    y: from + attach.t * (to - from),
  };
}

export const spanKey = (s: Span) => `${s.actor} ${s.startRow}-${s.endRow} d${s.depth}`;
