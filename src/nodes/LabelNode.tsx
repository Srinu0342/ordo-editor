import { useCallback } from "react";
import { useReactFlow } from "@xyflow/react";
import { LIGHT } from "../theme.js";
import EditableLabel from "./EditableLabel.jsx";
import { Anchors, nodeTheme } from "./chrome.jsx";

// Text with no frame. The degenerate case: there is no outline for an edge to
// terminate against, so anchors fall back to the text's own bounding box. Worth
// building early precisely because it breaks the assumption every other
// component quietly makes.

export default function LabelNode({ id, data, selected }) {
  const { setNodes } = useReactFlow();
  const theme = nodeTheme(selected);

  const setLabel = useCallback(
    (value) =>
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
        padding: "4px 6px",
        fontFamily: "system-ui, sans-serif",
        fontSize: 14,
        color: LIGHT["node.ink"],
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
        placeholder="text"
      />
      <Anchors />
    </div>
  );
}
