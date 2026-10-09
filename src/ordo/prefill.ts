import dagre from "@dagrejs/dagre";
import { GROUP_HEADER, GROUP_PAD, roomFor } from "./rf-mapping.ts";
import type { OrdoBox, OrdoLayoutFile, ResolvedDiagram } from "./types.ts";

const GAP = 40;

/**
 * Returns a box for every node. Boxes from the layout file are never moved or
 * resized. Missing positions: dagre per container when none of its children
 * are placed, otherwise a column to the right of the placed siblings. Groups
 * without an authored size get the bounding box of their children plus
 * padding. A leaf's size is only used for spacing — the size its kind (or a
 * box's shape) is dropped at, which is the size it draws at — and is NOT
 * returned, so it is never written back to a file. Whatever else the layout
 * file says about a node (its stacking, its turn, where it rides an edge)
 * passes straight through.
 */
export function prefill(diagram: ResolvedDiagram, layout: OrdoLayoutFile | null): Map<string, OrdoBox> {
  const authored = layout?.nodes ?? {};
  const parentOf = new Map(diagram.nodes.map((n) => [n.id, n.parent]));
  const children = new Map<string | null, string[]>();
  for (const n of diagram.nodes) {
    const siblings = children.get(n.parent);
    if (siblings) siblings.push(n.id);
    else children.set(n.parent, [n.id]);
  }
  const fallbackSize = new Map(diagram.nodes.map((n) => [n.id, roomFor(n)]));

  const pos = new Map<string, { x: number; y: number }>();
  const size = new Map<string, { w: number; h: number }>();
  for (const n of diagram.nodes) {
    if (!Object.hasOwn(authored, n.id)) continue; // a layout orphan is ignored
    const b = authored[n.id];
    pos.set(n.id, { x: b.x, y: b.y });
    // A text node is as big as its text, whatever size the file gives it.
    if (b.w !== undefined && b.h !== undefined && n.kind !== "text") size.set(n.id, { w: b.w, h: b.h });
  }
  const sizeOf = (id: string) => size.get(id) ?? fallbackSize.get(id)!;

  // Lift an endpoint to the direct child of `container` that contains it.
  const lift = (id: string, container: string | null): string | null => {
    let cur: string | null = id;
    while (cur !== null && parentOf.get(cur) !== container) cur = parentOf.get(cur) ?? null;
    return cur;
  };

  // Innermost containers first, so a group is sized before its parent lays it out.
  const containers: (string | null)[] = diagram.nodes
    .filter((n) => n.isGroup)
    .map((n) => n.id)
    .reverse();
  containers.push(null); // the canvas itself, last
  for (const c of containers) {
    const kids = children.get(c) ?? [];
    const ox = c === null ? 0 : GROUP_PAD;
    const oy = c === null ? 0 : GROUP_HEADER + GROUP_PAD;
    const missing = kids.filter((k) => !pos.has(k));

    if (missing.length && missing.length === kids.length) {
      const g = new dagre.graphlib.Graph();
      g.setGraph({ rankdir: "TB", nodesep: GAP, ranksep: GAP + 16 });
      g.setDefaultEdgeLabel(() => ({}));
      for (const k of kids) g.setNode(k, { width: sizeOf(k).w, height: sizeOf(k).h });
      for (const e of diagram.edges) {
        const a = lift(e.from, c);
        const b = lift(e.to, c);
        if (a && b && a !== b) g.setEdge(a, b);
      }
      dagre.layout(g);
      for (const k of kids) {
        const n = g.node(k);
        pos.set(k, { x: Math.round(n.x - n.width / 2) + ox, y: Math.round(n.y - n.height / 2) + oy });
      }
    } else if (missing.length) {
      const placed = kids.filter((k) => pos.has(k));
      const right = Math.max(...placed.map((k) => pos.get(k)!.x + sizeOf(k).w));
      let y = Math.min(...placed.map((k) => pos.get(k)!.y));
      for (const k of missing) {
        pos.set(k, { x: right + GAP, y });
        y += sizeOf(k).h + GAP;
      }
    }

    if (c !== null && !size.has(c)) {
      const empty = fallbackSize.get(c)!;
      const w = kids.length ? Math.max(...kids.map((k) => pos.get(k)!.x + sizeOf(k).w)) + GROUP_PAD : empty.w;
      const h = kids.length ? Math.max(...kids.map((k) => pos.get(k)!.y + sizeOf(k).h)) + GROUP_PAD : empty.h;
      size.set(c, { w, h });
    }
  }

  const out = new Map<string, OrdoBox>();
  for (const n of diagram.nodes) {
    const p = pos.get(n.id)!;
    const b = Object.hasOwn(authored, n.id) ? authored[n.id] : undefined;
    const s = n.isGroup ? size.get(n.id)! : b?.w !== undefined && b?.h !== undefined ? { w: b.w, h: b.h } : undefined;
    const { x: _x, y: _y, w: _w, h: _h, ...extra } = b ?? { x: 0, y: 0 };
    out.set(n.id, { x: p.x, y: p.y, ...(s ? { w: s.w, h: s.h } : {}), ...extra });
  }
  return out;
}
