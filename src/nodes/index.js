import BoxNode from "./BoxNode.jsx";
import ContainerNode from "./ContainerNode.jsx";
import CompartmentNode from "./CompartmentNode.jsx";
import LabelNode from "./LabelNode.jsx";
import { defaultSize, DEFAULT_SHAPE } from "../shapes/registry.js";

// Four components. Everything in the shape registry is a `box` carrying a
// different `data.shape`; only these four are node TYPES.
export const nodeTypes = {
  box: BoxNode,
  container: ContainerNode,
  compartment: CompartmentNode,
  label: LabelNode,
};

// Types that accept children. Kept here rather than in App so the containment
// rules travel with the components that implement them.
export const GROUP_TYPES = new Set(["container"]);

export const NODE_TYPE_DEFAULTS = {
  container: { size: [340, 210], data: { label: "group" } },
  compartment: {
    size: [190, 118],
    data: { label: "ClassName", sections: [["field: type"], ["method()"]] },
  },
  label: { size: [80, 26], data: { label: "text" } },
};

// One place that knows how to turn a palette pick into a node, so the drop
// handler and any future "add node" command cannot drift apart.
export function makeNode(kind, { id, position, parentId }) {
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
      ? { shape: kind ?? DEFAULT_SHAPE, label: "" }
      : { ...spec.data },
    ...(parentId ? { parentId } : {}),
  };
}

export const nodeSize = (kind) =>
  NODE_TYPE_DEFAULTS[kind]?.size ?? defaultSize(kind);
