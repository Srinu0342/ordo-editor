import { Handle, Position } from "@xyflow/react";
import { LIGHT } from "../theme.js";

// Interaction chrome — handles and the selection tint. Deliberately NOT part of
// any op-list: the headless renderer must never emit a connection handle.

export const COMPASS = [
  ["n", Position.Top],
  ["e", Position.Right],
  ["s", Position.Bottom],
  ["w", Position.Left],
];

export function Anchors() {
  return COMPASS.map(([id, position]) => (
    <Handle key={id} id={id} type="source" position={position} />
  ));
}

// Selection is a theme override rather than an extra drawn ring, so a selected
// node is the same op-list resolved against a different palette. Costs nothing
// and keeps the marks identical between canvas and export.
export const nodeTheme = (selected) =>
  selected ? { ...LIGHT, "node.stroke": LIGHT["node.stroke.selected"] } : LIGHT;
