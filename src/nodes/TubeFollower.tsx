import { useLayoutEffect } from "react";
import { useReactFlow, useStore } from "@xyflow/react";
import type { ReactFlowState } from "@xyflow/react";
import { edgePathEl, pointAt } from "../edges/attach.ts";
import { TUBE_TYPE, TUBE_SIZE } from "./tube.ts";
import type { Attach, OrdoEdge, OrdoNode } from "../types.ts";

// The half of the attachment that runs every frame.
//
// Nothing renders here. It exists because "the tube follows the edge" is not a
// property of either the tube or the edge — it is a rule about the pair, and
// the pair has no component. Mounted once inside the canvas, it re-derives
// every rider's position from its edge whenever anything that could have moved
// an edge has moved.
//
// The rider stores only `{ edgeId, t }`, plus an optional `shift`. Position is
// never the source of truth, which is why a reroute, a resize, a dragged
// endpoint or a viewport change all come out right without any of them being
// handled as a case.
//
// `shift` sets a rider off to one side of its edge, in px: positive is to the
// left of the direction of travel, which is east of a lifeline running down the
// canvas. It is how a re-entrant activation sits half a bar over from the one
// it nests in, the way UML draws it.
//
// A rider can sit inside a group — an imported diagram puts its bars in the
// same group as the lifelines they ride. The edge gives an absolute point; the
// position written back is relative to the group, like any child's.

// One string covering everything that can move a rider: absolute positions and
// measured sizes of every node, the edge list with each edge's route, and the
// attachments themselves — a tube that has just grabbed an edge has not moved
// yet, and without that last part the frame that settles it never arrives.
// Cheap to compare, and it changes exactly when a reposition is due.
const geometrySignal = (s: ReactFlowState) => {
  let acc = "";
  for (const [id, node] of s.nodeLookup) {
    const p = node.internals.positionAbsolute;
    acc += `${id}:${p.x},${p.y},${node.measured?.width},${node.measured?.height}`;
    // The store is not typed with Ordo's nodes; this is a rider's `attach`.
    const attach = node.data?.attach as Attach | undefined;
    if (attach) acc += `@${attach.edgeId},${attach.t},${attach.shift ?? 0}`;
    acc += ";";
  }
  acc += "|";
  for (const e of s.edges)
    acc += `${e.id}:${e.type},${e.sourceHandle},${e.targetHandle};`;
  return acc;
};

// Sub-pixel disagreement is not movement; without a threshold the commit below
// would re-enter on its own output forever.
const EPS = 0.25;

export default function TubeFollower() {
  const { setNodes, getNodes, getEdges, getInternalNode } = useReactFlow<
    OrdoNode,
    OrdoEdge
  >();
  const signal = useStore(geometrySignal);

  useLayoutEffect(() => {
    const live = new Set(getEdges().map((e) => e.id));
    const moves = new Map<string, { x: number; y: number; angle: number }>();
    const dropped = new Set<string>();

    for (const node of getNodes()) {
      if (node.type !== TUBE_TYPE) continue;

      const attach = node.data?.attach;
      if (!attach) continue;

      // The edge is gone: so is the attachment. Judged against the edge list
      // rather than the DOM, because an edge can be absent from the DOM for a
      // frame and that is not the same as deleted.
      if (!live.has(attach.edgeId)) {
        dropped.add(node.id);
        continue;
      }

      // While you are holding it, the pointer owns the position. The follower
      // takes over again on drop, which is what makes the snap-back visible.
      if (node.dragging) continue;

      const at = pointAt(edgePathEl(attach.edgeId), attach.t);
      if (!at) continue;

      const w = node.measured?.width ?? node.style?.width ?? TUBE_SIZE[0];
      const h = node.measured?.height ?? node.style?.height ?? TUBE_SIZE[1];
      const shift = attach.shift ?? 0;
      const rad = (at.angle * Math.PI) / 180;
      const origin = node.parentId
        ? getInternalNode(node.parentId)?.internals.positionAbsolute
        : null;
      const x = at.x - w / 2 + shift * Math.sin(rad) - (origin?.x ?? 0);
      const y = at.y - h / 2 - shift * Math.cos(rad) - (origin?.y ?? 0);

      const turned = Math.abs((attach.angle ?? 0) - at.angle) > 0.05;
      if (
        Math.abs(node.position.x - x) > EPS ||
        Math.abs(node.position.y - y) > EPS ||
        turned
      ) {
        moves.set(node.id, { x, y, angle: at.angle });
      }
    }

    if (!moves.size && !dropped.size) return;

    setNodes((nds) =>
      nds.map((n) => {
        if (dropped.has(n.id)) {
          const { attach: _gone, ...data } = n.data;
          return { ...n, data };
        }

        const move = moves.get(n.id);
        if (!move) return n;

        return {
          ...n,
          position: { x: move.x, y: move.y },
          data: { ...n.data, attach: { ...n.data.attach, angle: move.angle } },
        };
      }),
    );
  }, [signal, getNodes, getEdges, getInternalNode, setNodes]);

  return null;
}
