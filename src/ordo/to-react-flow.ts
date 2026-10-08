import { prefill } from "./prefill.ts";
import { rfEdge, rfNode } from "./rf-mapping.ts";
import type { OrdoEdge, OrdoNode } from "../types.ts";
import type { OrdoLayoutFile, ResolvedDiagram } from "./types.ts";

/** Resolved diagram (+ optional layout) -> React Flow. Nodes come out parents-first, as React Flow requires. */
export function toReactFlow(
  diagram: ResolvedDiagram,
  layout: OrdoLayoutFile | null,
): { nodes: OrdoNode[]; edges: OrdoEdge[] } {
  const boxes = prefill(diagram, layout);
  const handles = layout?.edges ?? {};
  return {
    nodes: diagram.nodes.map((n) => rfNode(n, boxes.get(n.id)!)),
    edges: diagram.edges.map((e) => rfEdge(e, Object.hasOwn(handles, e.id) ? handles[e.id] : undefined)),
  };
}
