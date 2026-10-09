import { useCallback } from "react";
import { useReactFlow, NodeResizer } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";
import EditableLabel from "./EditableLabel.tsx";
import { Anchors, useNodeTheme } from "./chrome.tsx";
import type { OrdoEdge, OrdoNode } from "../types.ts";

// Holds child nodes. Not a Box with a dashed border: the containment tree, the
// title band that children must not overlap, and the parent-relative coordinate
// frame are all structural, which is what makes it a type.

export default function ContainerNode({
  id,
  data,
  selected,
}: NodeProps<OrdoNode>) {
  const { setNodes } = useReactFlow<OrdoNode, OrdoEdge>();
  const theme = useNodeTheme(selected);
  const isDropTarget = Boolean(data.isDropTarget);

  const setLabel = useCallback(
    (value: string) =>
      setNodes((nds) =>
        nds.map((nd) =>
          nd.id === id ? { ...nd, data: { ...nd.data, label: value } } : nd,
        ),
      ),
    [id, setNodes],
  );

  return (
    <>
      <NodeResizer
        isVisible={selected}
        minWidth={140}
        minHeight={90}
        color={theme["node.stroke.selected"]}
      />
      <div
        style={{
          width: "100%",
          height: "100%",
          boxSizing: "border-box",
          borderRadius: 6,
          border: `1.5px dashed ${theme["node.stroke"]}`,
          background: isDropTarget ? "rgba(99,102,241,0.12)" : "transparent",
          outline: isDropTarget ? `2px dashed ${theme["node.accent"]}` : "none",
          outlineOffset: 2,
          position: "relative",
        }}
      >
        {/* title band — children are laid out below it, which is why the
            container cannot be a Box with a label slot */}
        <div
          style={{
            position: "absolute",
            top: -12,
            left: 10,
            padding: "0 6px",
            background: theme["container.band"],
            fontSize: 14,
            fontWeight: 600,
            color: theme["node.ink.muted"],
            fontFamily: "system-ui, sans-serif",
            borderRadius: 3,
          }}
        >
          <EditableLabel
            value={data.label ?? ""}
            onChange={setLabel}
            placeholder="group"
          />
        </div>
        <Anchors />
      </div>
    </>
  );
}
