import { TUBE_TYPE, TUBE_SIZE } from "./tube.ts";
import { FRAGMENT_TYPE } from "./fragment.ts";
import type { CSSProperties } from "react";
import { defaultSize, DEFAULT_SHAPE } from "../shapes/registry.ts";
import { measureText } from "../measure.ts";
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

// A text node has no frame, so the only edge it has is its words: it is as big
// as its text, and its anchors and selection ring sit just outside it rather
// than at the side of a box nobody can see. React Flow measures it; this is
// what LabelNode draws it in, and its size before it has been measured.
export const TEXT_FONT = { size: 16, weight: 400 };
export const TEXT_PAD: [y: number, x: number] = [3, 5];
export const TEXT_PLACEHOLDER = "text"; // shown, and sized, while it is empty
const TEXT_BORDER = 1; // drawn only when selected, always there to keep the size

export const textSize = (text: string): Size => {
  const { width, height } = measureText(text || TEXT_PLACEHOLDER, TEXT_FONT);
  const [py, px] = TEXT_PAD;
  return [
    Math.ceil(width) + 2 * (px + TEXT_BORDER),
    Math.ceil(height) + 2 * (py + TEXT_BORDER),
  ];
};

export type TypeDefaults = {
  // The size it is dropped at — or, for an intrinsic type, the estimate used
  // until React Flow has measured it.
  size: Size;
  data: NodeData;
  // Sized by its own content: it is given no size, so nothing can hold it
  // bigger than what it shows.
  intrinsic?: boolean;
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
  label: { size: textSize("text"), data: { label: "text" }, intrinsic: true },
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
    style: { ...(spec?.intrinsic ? {} : { width: w, height: h }), ...spec?.style },
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
// measured it, so fall back through the explicit style and the measurement to
// the registry. A text node has no registry size: its words are its size.
export const sizeOfNode = (node: OrdoNode): Size => {
  const [w, h] =
    node.type === "label"
      ? textSize(String(node.data?.label ?? ""))
      : nodeSize(nodeKind(node));
  return [
    node.width ?? node.style?.width ?? node.measured?.width ?? w,
    node.height ?? node.style?.height ?? node.measured?.height ?? h,
  ];
};
