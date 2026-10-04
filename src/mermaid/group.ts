// Every import arrives as ONE group: a container holding the whole diagram, so
// it can be selected and moved as a unit — copied and deleted as one too — and
// share a canvas with other diagrams.
//
// Everything in it is namespaced under the group's id. Mermaid's own ids ("A",
// "B", "L_A_B_0") repeat from diagram to diagram, and so do the sequence
// importer's ("seq:head:App"); prefixed, a second import of the same diagram
// never collides with the first.
//
// The diagram's top-level nodes become the group's children, re-expressed
// against its corner; nodes already inside a subgraph keep their own parent.
// The tubes go in too. A tube is never ADOPTED by a drop (see UNPARENTED_TYPES),
// but these ride lifelines whose ends are in the same group, so the group and
// the edge always agree on where a rider belongs.

import type { Graph, NodeData, OrdoNode, Size, XY } from "../types.ts";

const PAD = 24; // the diagram to the group's border
const PAD_TOP = 32; // room under the title band

// React Flow draws a child at its own zIndex unless its parent sits at or above
// it, and selecting a parent lifts the parent by 1000. Parked this far down,
// the group stays below everything it holds even while selected, so selecting
// it never flattens the diagram's stacking — frames over bars, fills under
// lifelines.
export const GROUP_Z = -2000;

const UNTITLED = /^mermaid(\d+)$/i;

/**
 * The group's name: the diagram's own title if it has one, else `mermaidN`,
 * numbered on from the highest `mermaidN` already on the canvas — so a
 * deleted group's number is never handed out again while a later one exists.
 */
export function diagramName(
  title: string | null | undefined,
  nodes: Pick<OrdoNode, "data">[] = [],
) {
  const named = String(title ?? "").trim();
  if (named) return named;

  let highest = 0;
  for (const n of nodes) {
    const m = UNTITLED.exec(String(n.data?.label ?? "").trim());
    if (m) highest = Math.max(highest, Number(m[1]));
  }
  return `mermaid${highest + 1}`;
}

/** A group id nothing on the canvas is using. */
export function groupId(nodes: Pick<OrdoNode, "id">[] = []) {
  const taken = new Set(nodes.map((n) => n.id));
  let k = 1;
  while (taken.has(`mermaid-${k}`)) k += 1;
  return `mermaid-${k}`;
}

const sizeOf = (n: OrdoNode): Size => [
  n.style?.width ?? n.width ?? 0,
  n.style?.height ?? n.height ?? 0,
];

/**
 * Wrap an import in its group, with the group's top-left at `at`.
 * @returns { group, nodes, edges } — the group first in `nodes`, since React
 *          Flow wants a parent before its children.
 */
export function groupDiagram(
  { nodes, edges }: Graph,
  {
    id,
    label,
    at = { x: 0, y: 0 },
    data = {},
  }: { id: string; label: string; at?: XY; data?: NodeData },
): Graph & { group: OrdoNode } {
  const ns = (key: string) => `${id}/${key}`;

  // Top-level nodes are enough for the bounds: a subgraph's children lie inside it.
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const n of nodes) {
    if (n.parentId) continue;
    const [w, h] = sizeOf(n);
    x1 = Math.min(x1, n.position.x);
    y1 = Math.min(y1, n.position.y);
    x2 = Math.max(x2, n.position.x + w);
    y2 = Math.max(y2, n.position.y + h);
  }
  if (x1 === Infinity) x1 = y1 = x2 = y2 = 0;

  // The group's corner, in the diagram's own coordinates.
  const corner = { x: x1 - PAD, y: y1 - PAD_TOP };

  const group: OrdoNode = {
    id,
    type: "container",
    position: { x: at.x, y: at.y },
    style: { width: x2 - x1 + 2 * PAD, height: y2 - y1 + PAD_TOP + PAD },
    zIndex: GROUP_Z,
    data: { label, ...data },
  };

  const inner = nodes.map((n) => {
    const out: OrdoNode = { ...n, id: ns(n.id) };
    if (n.parentId) {
      out.parentId = ns(n.parentId);
    } else {
      out.parentId = id;
      out.position = { x: n.position.x - corner.x, y: n.position.y - corner.y };
    }
    const attach = n.data?.attach;
    if (attach?.edgeId)
      out.data = { ...n.data, attach: { ...attach, edgeId: ns(attach.edgeId) } };
    return out;
  });

  const wires = edges.map((e) => ({
    ...e,
    id: ns(e.id),
    source: ns(e.source),
    target: ns(e.target),
  }));

  return { group, nodes: [group, ...inner], edges: wires };
}
