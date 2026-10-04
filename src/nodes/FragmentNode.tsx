import { useCallback, useMemo } from "react";
import type { CSSProperties } from "react";
import {
  NodeResizer,
  NodeToolbar,
  Position,
  useReactFlow,
} from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";
import { labelBox, walk } from "../render/reactWalker.tsx";
import EditableLabel from "./EditableLabel.tsx";
import { nodeTheme } from "./chrome.tsx";
import {
  TAB_H,
  drawFragment,
  guardIndex,
  isPlain,
  stepOperands,
  tabWidth,
} from "./fragment.ts";
import type { NodeData, OrdoEdge, OrdoNode } from "../types.ts";

// The combined-fragment frame. The drawing is fragment.ts's op-list; this adds
// the chrome — resizer, operand stepper, editable labels — and the hit area.
//
// The node's own box ignores the pointer (see NODE_TYPE_DEFAULTS): only the
// border, the tab and the labels take clicks. A frame drawn round half a
// diagram must not swallow the clicks meant for the lifelines, bars and
// messages inside it, and dragging on empty space inside it should still pan.

// How far either side of the border still counts as the border.
const HIT = 10;

const chip: CSSProperties = {
  font: "inherit",
  fontSize: 11,
  lineHeight: 1,
  padding: "4px 7px",
  border: "1px solid #cbd5e1",
  background: "#fff",
  borderRadius: 4,
  cursor: "pointer",
  color: "#475569",
};

export default function FragmentNode({
  id,
  data,
  selected,
  width,
  height,
}: NodeProps<OrdoNode>) {
  const { setNodes } = useReactFlow<OrdoNode, OrdoEdge>();
  const w = Math.max(1, width ?? 320);
  const h = Math.max(1, height ?? 180);
  const operator = data.operator ?? "";
  const plain = isPlain(operator);

  const theme = nodeTheme(selected);
  const { marks, labels } = useMemo(
    () => walk(drawFragment(w, h, data), theme),
    [w, h, data, theme],
  );

  const patch = useCallback(
    (fn: (data: NodeData) => NodeData) =>
      setNodes((nds) =>
        nds.map((nd) => (nd.id === id ? { ...nd, data: fn(nd.data) } : nd)),
      ),
    [id, setNodes],
  );

  const setSlot = useCallback(
    (slot: string, value: string) =>
      patch((d) => {
        if (slot === "operator") return { ...d, operator: value };
        const guards = [...(d.guards ?? [])];
        guards[guardIndex(slot)] = value;
        return { ...d, guards };
      }),
    [patch],
  );

  const valueOf = (slot: string) =>
    slot === "operator" ? operator : (data.guards?.[guardIndex(slot)] ?? "");

  return (
    <>
      <NodeResizer
        isVisible={selected}
        minWidth={120}
        minHeight={plain ? 40 : 60}
        color={theme["node.stroke.selected"]}
        // the resizer lives inside the node's box, which ignores the pointer
        handleStyle={{ pointerEvents: "all" }}
        lineStyle={{ pointerEvents: "all" }}
      />

      {/* Shown only while this frame is the one node selected (React Flow's
          default when isVisible is left out). */}
      {!plain && (
        <NodeToolbar position={Position.Top} align="start">
          <div
            style={{ display: "flex", gap: 4, fontFamily: "system-ui, sans-serif" }}
          >
            <button
              type="button"
              style={chip}
              disabled={!data.dividers?.length}
              onClick={() => patch((d) => stepOperands(d, -1, h))}
              title="Remove the last operand"
            >
              − operand
            </button>
            <button
              type="button"
              style={chip}
              onClick={() => patch((d) => stepOperands(d, 1, h))}
              title="Add an operand — else, and, option"
            >
              + operand
            </button>
          </div>
        </NodeToolbar>
      )}

      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <svg
          viewBox={`0 0 ${w} ${h}`}
          width="100%"
          height="100%"
          style={{ display: "block", overflow: "visible" }}
        >
          {marks}
        </svg>

        {/* The hit area: the border band, plus the tab or a box's title. */}
        <svg
          viewBox={`0 0 ${w} ${h}`}
          width="100%"
          height="100%"
          style={{ position: "absolute", inset: 0, overflow: "visible" }}
        >
          <rect
            width={w}
            height={h}
            fill="none"
            stroke="transparent"
            strokeWidth={HIT * 2}
            pointerEvents="stroke"
          />
          {!plain && (
            <rect
              width={Math.min(tabWidth(operator), w)}
              height={TAB_H}
              fill="transparent"
              pointerEvents="all"
            />
          )}
          {operator === "box" && (
            <rect width={w} height={28} fill="transparent" pointerEvents="all" />
          )}
        </svg>

        {labels.map((slot) => {
          const guard = slot.slot !== "operator" && operator !== "box";
          return (
            <div key={slot.key} style={labelBox(slot, w, h, theme)}>
              {guard && "["}
              <EditableLabel
                value={valueOf(slot.slot)}
                onChange={(v) => setSlot(slot.slot, v)}
                placeholder={
                  slot.slot === "operator"
                    ? "loop"
                    : operator === "box"
                      ? "title"
                      : "condition"
                }
              />
              {guard && "]"}
            </div>
          );
        })}
      </div>
    </>
  );
}
