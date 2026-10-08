import { TUBE_TYPE, TUBE_SIZE } from "./tube.ts";
import { FRAGMENT_TYPE } from "./fragment.ts";
import type { CSSProperties } from "react";
import { defaultSize, DEFAULT_SHAPE } from "../shapes/registry.ts";
import type { NodeData, OrdoNode, Size, XY } from "../types.ts";

// What a node IS before anything draws it: the defaults each palette pick
// starts from, the containment rules, and a node's best-known size. No
// component lives here, so the file format's tests can build nodes exactly the
// way the palette does without loading React (nodes/index.ts re-exports all of
// it beside the components).

// Types that accept children. Kept here rather than in App so the containment
// rules travel with the components that implement them.
export const GROUP_TYPES = new Set<string | undefined>(["container"]);

// Types a drop never adopts. A tube belongs to the edge it rides, and a node
// cannot be held by two frames of reference at once — dropped into a group, it
// would be a child that its follower keeps yanking around inside its parent.
// The one way a tube gets a parent is an import: a diagram's bars are created
// inside the diagram's group, together with the lifelines they ride, so the
// group and the edge always move them the same way (see mermaid/group.ts).
export const UNPARENTED_TYPES = new Set<string | undefined>([TUBE_TYPE]);

export const isUnparented = (node?: Pick<OrdoNode, "type">) =>
  UNPARENTED_TYPES.has(node?.type);

export type TypeDefaults = {
  size: Size;
  data: NodeData;
  // anything but the size, which `size` holds
  style?: Omit<CSSProperties, "width" | "height">;
  zIndex?: number;
};

export const NODE_TYPE_DEFAULTS: Record<string, TypeDefaults> = {
  container: { size: [340, 210], data: { label: "group" } },
  compartment: {
    size: [190, 118],
    data: { label: "ClassName", sections: [["field: type"], ["method()"]] },
  },
  label: { size: [80, 26], data: { label: "text" } },
  [TUBE_TYPE]: { size: TUBE_SIZE, data: { slots: 3 } },
  [FRAGMENT_TYPE]: {
    size: [320, 180],
    data: { operator: "loop", guards: ["condition"], dividers: [] },
    // Grabbed by its border and tab only (see FragmentNode). Drawn over the
    // lifelines and bars it frames, as Mermaid draws it: its body is
    // transparent, and a bar on top would hide the operator and the guards.
    style: { pointerEvents: "none" },
    zIndex: 1,
  },
};

// One place that knows how to turn a palette pick into a node, so the drop
// handler and any future "add node" command cannot drift apart.
export function makeNode(
  kind: string,
  {
    id,
    position,
    parentId,
    data,
  }: { id: string; position: XY; parentId?: string; data?: NodeData },
): OrdoNode {
  const spec: TypeDefaults | undefined = NODE_TYPE_DEFAULTS[kind];
  const isShape = !spec;
  const type = isShape ? "box" : kind;
  const [w, h] = isShape ? defaultSize(kind) : spec.size;

  return {
    id,
    type,
    position,
    style: { width: w, height: h, ...spec?.style },
    data: isShape
      ? { shape: kind ?? DEFAULT_SHAPE, label: "", ...data }
      : { ...spec.data, ...data },
    ...(spec?.zIndex !== undefined ? { zIndex: spec.zIndex } : {}),
    ...(parentId ? { parentId } : {}),
  };
}

export const nodeSize = (kind: string): Size =>
  NODE_TYPE_DEFAULTS[kind]?.size ?? defaultSize(kind);

// The palette key a live node came from: `box` carries it in data.shape,
// every other type IS its key. Lets a node be measured, cloned or re-drawn
// without the caller knowing which of the two cases it is looking at.
export const nodeKind = (node: OrdoNode) =>
  node.type === "box"
    ? (node.data?.shape ?? DEFAULT_SHAPE)
    : (node.type ?? DEFAULT_SHAPE);

// Best available size for a node that may not be mounted yet — a freshly
// pasted node has to be hit-tested against groups before React Flow has
// measured it, so fall back through the explicit style to the registry.
export const sizeOfNode = (node: OrdoNode): Size => [
  node.width ?? node.style?.width ?? nodeSize(nodeKind(node))[0],
  node.height ?? node.style?.height ?? nodeSize(nodeKind(node))[1],
];
