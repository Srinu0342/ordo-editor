import BoxNode from "./BoxNode.jsx";
import ContainerNode from "./ContainerNode.jsx";
import CompartmentNode from "./CompartmentNode.jsx";
import LabelNode from "./LabelNode.jsx";
import TubeNode, { TUBE_TYPE, TUBE_SIZE } from "./TubeNode.jsx";
import { defaultSize, DEFAULT_SHAPE } from "../shapes/registry.js";

// Five components. Everything in the shape registry is a `box` carrying a
// different `data.shape`; only these five are node TYPES.
export const nodeTypes = {
  box: BoxNode,
  container: ContainerNode,
  compartment: CompartmentNode,
  label: LabelNode,
  [TUBE_TYPE]: TubeNode,
};

// Types that accept children. Kept here rather than in App so the containment
// rules travel with the components that implement them.
export const GROUP_TYPES = new Set(["container"]);

// Types that are never anybody's child. A tube belongs to the edge it rides,
// and a node cannot be held by two frames of reference at once — so it stays
// out of the containment tree entirely rather than being a child that a
// follower keeps yanking around inside its parent.
export const UNPARENTED_TYPES = new Set([TUBE_TYPE]);

export const isUnparented = (node) => UNPARENTED_TYPES.has(node?.type);

export { TUBE_TYPE, TUBE_SIZE } from "./TubeNode.jsx";
export { default as TubeFollower } from "./TubeFollower.jsx";

export const NODE_TYPE_DEFAULTS = {
  container: { size: [340, 210], data: { label: "group" } },
  compartment: {
    size: [190, 118],
    data: { label: "ClassName", sections: [["field: type"], ["method()"]] },
  },
  label: { size: [80, 26], data: { label: "text" } },
  [TUBE_TYPE]: { size: TUBE_SIZE, data: { slots: 3 } },
};

// One place that knows how to turn a palette pick into a node, so the drop
// handler and any future "add node" command cannot drift apart.
export function makeNode(kind, { id, position, parentId, data }) {
  const isShape = !NODE_TYPE_DEFAULTS[kind];
  const type = isShape ? "box" : kind;
  const spec = NODE_TYPE_DEFAULTS[kind] ?? {};
  const [w, h] = isShape ? defaultSize(kind) : spec.size;

  return {
    id,
    type,
    position,
    style: { width: w, height: h },
    data: isShape
      ? { shape: kind ?? DEFAULT_SHAPE, label: "", ...data }
      : { ...spec.data, ...data },
    ...(parentId ? { parentId } : {}),
  };
}

export const nodeSize = (kind) =>
  NODE_TYPE_DEFAULTS[kind]?.size ?? defaultSize(kind);

// The palette key a live node came from: `box` carries it in data.shape,
// every other type IS its key. Lets a node be measured, cloned or re-drawn
// without the caller knowing which of the two cases it is looking at.
export const nodeKind = (node) =>
  node.type === "box" ? (node.data?.shape ?? DEFAULT_SHAPE) : node.type;

// Best available size for a node that may not be mounted yet — a freshly
// pasted node has to be hit-tested against groups before React Flow has
// measured it, so fall back through the explicit style to the registry.
export const sizeOfNode = (node) => [
  node.width ?? node.style?.width ?? nodeSize(nodeKind(node))[0],
  node.height ?? node.style?.height ?? nodeSize(nodeKind(node))[1],
];
