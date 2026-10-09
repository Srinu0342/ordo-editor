import { useCallback, useMemo } from "react";
import { useReactFlow, NodeResizer } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";
import { drawShape, defaultSize, DEFAULT_SHAPE } from "../shapes/registry.ts";
import { walk, labelBox } from "../render/reactWalker.tsx";
import EditableLabel from "./EditableLabel.tsx";
import { Anchors, useNodeTheme } from "./chrome.tsx";
import { fontOf } from "../textStyle.ts";
import type { OrdoEdge, OrdoNode } from "../types.ts";

// ONE component for all 47 shapes. The shape is a property, the geometry comes
// from the registry, and the drawing comes from the shared walker — so adding
// a shape never touches this file. That is the entire argument of the
// organising cut, in about sixty lines.

export default function BoxNode({
  id,
  data,
  selected,
  width,
  height,
}: NodeProps<OrdoNode>) {
  const { setNodes } = useReactFlow<OrdoNode, OrdoEdge>();
  const shape = data.shape ?? DEFAULT_SHAPE;

  // Measured size wins; the registry default covers the first frame before
  // React Flow has measured anything.
  const [dw, dh] = defaultSize(shape);
  const w = Math.max(1, width ?? dw);
  const h = Math.max(1, height ?? dh);

  const theme = useNodeTheme(selected);
  const { marks, labels } = useMemo(
    () => walk(drawShape(shape, w, h), theme),
    [shape, w, h, theme],
  );

  const setSlot = useCallback(
    (slot: string, value: string) =>
      setNodes((nds) =>
        nds.map((nd) =>
          nd.id === id ? { ...nd, data: { ...nd.data, [slot]: value } } : nd,
        ),
      ),
    [id, setNodes],
  );

  return (
    <>
      <NodeResizer
        isVisible={selected}
        minWidth={24}
        minHeight={16}
        color={theme["node.stroke.selected"]}
      />
      <div style={{ position: "relative", width: "100%", height: "100%" }}>
        <svg
          viewBox={`0 0 ${w} ${h}`}
          width="100%"
          height="100%"
          style={{ display: "block", overflow: "visible" }}
        >
          {marks}
        </svg>

        {labels.map((slot) => (
          <div
            key={slot.key}
            style={labelBox({ ...slot, ...fontOf(slot, data) }, w, h, theme)}
          >
            <EditableLabel
              value={String(data[slot.slot] ?? "")}
              onChange={(v) => setSlot(slot.slot, v)}
              placeholder="label"
              style={{ textAlign: slot.align }}
            />
          </div>
        ))}

        <Anchors />
      </div>
    </>
  );
}
