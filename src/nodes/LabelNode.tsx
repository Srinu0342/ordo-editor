import { useCallback } from "react";
import { useReactFlow } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";
import EditableLabel from "./EditableLabel.tsx";
import { Anchors, useNodeTheme } from "./chrome.tsx";
import { TEXT_FONT, TEXT_PAD, TEXT_PLACEHOLDER } from "./defaults.ts";
import { LINE_HEIGHT } from "../measure.ts";
import { fontOf } from "../textStyle.ts";
import type { OrdoEdge, OrdoNode } from "../types.ts";

// Text with no frame. The degenerate case: there is no outline for an edge to
// terminate against, so anchors fall back to the text's own bounding box. Worth
// building early precisely because it breaks the assumption every other
// component quietly makes.
//
// The node is given no size (see TEXT_FONT): it is exactly as big as its
// words, so an edge ends a few px from the text rather than at the side of an
// invisible box. Should a size reach it anyway, the text sits in its middle.

export default function LabelNode({ id, data, selected }: NodeProps<OrdoNode>) {
  const { setNodes } = useReactFlow<OrdoNode, OrdoEdge>();
  const theme = useNodeTheme(selected);
  const font = fontOf(TEXT_FONT, data);

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
    <div
      style={{
        width: "100%",
        height: "100%",
        boxSizing: "border-box",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: `${TEXT_PAD[0]}px ${TEXT_PAD[1]}px`,
        fontFamily: "system-ui, sans-serif",
        fontSize: font.size,
        fontWeight: font.weight,
        lineHeight: LINE_HEIGHT,
        color: theme["node.ink"],
        border: `1px ${selected ? "solid" : "dashed"} ${
          selected ? theme["node.stroke.selected"] : "transparent"
        }`,
        borderRadius: 3,
        position: "relative",
      }}
    >
      <EditableLabel
        value={data.label ?? ""}
        onChange={setLabel}
        placeholder={TEXT_PLACEHOLDER}
        grab
      />
      <Anchors />
    </div>
  );
}
