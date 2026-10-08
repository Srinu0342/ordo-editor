import BoxNode from "./BoxNode.tsx";
import ContainerNode from "./ContainerNode.tsx";
import CompartmentNode from "./CompartmentNode.tsx";
import LabelNode from "./LabelNode.tsx";
import TubeNode from "./TubeNode.tsx";
import FragmentNode from "./FragmentNode.tsx";
import { TUBE_TYPE } from "./tube.ts";
import { FRAGMENT_TYPE } from "./fragment.ts";

// Six components. Everything in the shape registry is a `box` carrying a
// different `data.shape`; only these six are node TYPES.
export const nodeTypes = {
  box: BoxNode,
  container: ContainerNode,
  compartment: CompartmentNode,
  label: LabelNode,
  [TUBE_TYPE]: TubeNode,
  [FRAGMENT_TYPE]: FragmentNode,
};

// The React-free half — palette defaults, makeNode, sizes and the containment
// rules — lives in defaults.ts so that code with no business loading React can
// build a node the palette's way. Re-exported here, so this stays the one
// import the canvas needs.
export * from "./defaults.ts";

export { TUBE_TYPE, TUBE_SIZE, TRACK } from "./tube.ts";
export { FRAGMENT_TYPE } from "./fragment.ts";
export { default as TubeFollower } from "./TubeFollower.tsx";
