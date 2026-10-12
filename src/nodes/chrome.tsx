import { createContext, useContext, useEffect, useMemo } from "react";
import type { CSSProperties } from "react";
import { Handle, Position, useNodeId, useStore } from "@xyflow/react";
import type { ReactFlowState } from "@xyflow/react";
import { endHandles, nodeBox } from "../edges/faces.ts";
import { LIGHT } from "../theme.ts";
import type { Theme } from "../theme.ts";

// Interaction chrome — handles and the selection tint. Deliberately NOT part of
// any op-list: the headless renderer must never emit a connection handle.

export const COMPASS: [id: string, position: Position][] = [
  ["n", Position.Top],
  ["e", Position.Right],
  ["s", Position.Bottom],
  ["w", Position.Left],
];

export function Anchors({ selected }: { selected: boolean }) {
  const anchor = useAnchorStyle(selected);
  return COMPASS.map(([id, position]) => (
    <Handle
      key={id}
      id={id}
      type="source"
      position={position}
      style={anchor(id)}
    />
  ));
}

// The handles of node `id` an edge is drawn from, space-separated. A string so
// the store compares it by value, and a node re-renders only when its set of
// wired handles changes — not on every frame of a drag.
const wiredOf = (s: ReactFlowState, id: string | null) => {
  const wired = new Set<string>();
  for (const c of (id && s.connectionLookup.get(id)?.values()) || []) {
    const [from, to] = endHandles(
      nodeBox(s.nodeLookup.get(c.source)),
      nodeBox(s.nodeLookup.get(c.target)),
      c,
    );
    if (c.source === id && from) wired.add(from);
    if (c.target === id && to) wired.add(to);
  }
  return [...wired].sort().join(" ");
};

// Dragging out an edge, or holding one started by a click on a handle.
const connecting = (s: ReactFlowState) =>
  s.connection.inProgress || s.connectionClickStartHandle !== null;

const HIDDEN: CSSProperties = { visibility: "hidden" };
const SHOWN: CSSProperties = {};

/**
 * The style that shows or hides each of this node's handles. A handle is only
 * there to make a connection, so it shows where one is being made or already
 * is: every handle of a selected node, the handles an edge ends on, and every
 * handle anywhere while an edge is being drawn, since those are where it could
 * land. The rest are hidden rather than removed, so React Flow still measures
 * them and an edge can still be drawn to one.
 */
export function useAnchorStyle(selected: boolean) {
  const id = useNodeId();
  const wired = useStore((s) => wiredOf(s, id));
  const drawing = useStore(connecting);
  return (handle: string) =>
    selected || drawing || wired.split(" ").includes(handle) ? SHOWN : HIDDEN;
}

// The palette the canvas resolves its tokens against: LIGHT or DARK, picked by
// the app's colour scheme. Light outside a provider, which is what tests and
// any headless render get.
export const ThemeContext = createContext<Theme>(LIGHT);

export const useCanvasTheme = () => useContext(ThemeContext);

// The text node that should open for typing as soon as it can: one just
// dropped from the palette, or the one selected when Enter is pressed. App
// asks; the node with that id opens and clears the request, so it opens once.
export type EditRequest = { id: string | null; clear: () => void };

export const EditRequestContext = createContext<EditRequest>({
  id: null,
  clear: () => {},
});

/** Whether the canvas has asked node `id` to open for typing. */
export function useEditRequest(id: string, open: () => void) {
  const request = useContext(EditRequestContext);
  const asked = request.id === id;
  useEffect(() => {
    if (!asked) return;
    request.clear();
    open();
  }, [asked, request, open]);
}

// Selection is a theme override rather than an extra drawn ring, so a selected
// node is the same op-list resolved against a different palette. Costs nothing
// and keeps the marks identical between canvas and export.
export const useNodeTheme = (selected: boolean): Theme => {
  const theme = useCanvasTheme();
  return useMemo(
    () =>
      selected
        ? { ...theme, "node.stroke": theme["node.stroke.selected"] }
        : theme,
    [theme, selected],
  );
};
