import { useCallback, useState } from "react";
import { useReactFlow } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";
import EditableLabel from "./EditableLabel.tsx";
import { Anchors, useEditRequest, useNodeTheme } from "./chrome.tsx";
import { TEXT_FONT, TEXT_PAD, TEXT_PLACEHOLDER } from "./defaults.ts";
import { LINE_HEIGHT } from "../measure.ts";
import { alignOf, fontOf } from "../textStyle.ts";
import type { OrdoEdge, OrdoNode } from "../types.ts";

// Text with no frame. The degenerate case: there is no outline for an edge to
// terminate against, so anchors fall back to the text's own bounding box. Worth
// building early precisely because it breaks the assumption every other
// component quietly makes.
//
// The node is given no size (see TEXT_FONT): it is exactly as big as its
// words, so an edge ends a few px from the text rather than at the side of an
// invisible box. Should a size reach it anyway, the text sits in its middle.
//
// It takes as many lines as it is typed with: Enter starts a new one, and
// Escape, Cmd/Ctrl+Enter or a click away finishes. It opens for typing the
// moment it is dropped, or on Enter while it is the one selected, with its
// text selected so typing replaces it. Text finished empty is no text at all,
// so the node goes, and the lines it had with it.

export default function LabelNode({ id, data, selected }: NodeProps<OrdoNode>) {
  const { setNodes, getNode, deleteElements } = useReactFlow<OrdoNode, OrdoEdge>();
  const theme = useNodeTheme(selected);
  const font = fontOf(TEXT_FONT, data);
  const [editing, setEditing] = useState(false);

  const setLabel = useCallback(
    (value: string) =>
      setNodes((nds) =>
        nds.map((nd) =>
          nd.id === id ? { ...nd, data: { ...nd.data, label: value } } : nd,
        ),
      ),
    [id, setNodes],
  );

  const onEditingChange = useCallback(
    (next: boolean) => {
      setEditing(next);
      if (next) return;
      const label = getNode(id)?.data.label;
      if (!String(label ?? "").trim()) void deleteElements({ nodes: [{ id }] });
    },
    [id, getNode, deleteElements],
  );

  const open = useCallback(() => setEditing(true), []);
  useEditRequest(id, open);

  const framed = selected || editing;

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
        border: `1px ${framed ? "solid" : "dashed"} ${
          framed ? theme["node.stroke.selected"] : "transparent"
        }`,
        borderRadius: 3,
        position: "relative",
      }}
    >
      <EditableLabel
        value={data.label ?? ""}
        onChange={setLabel}
        placeholder={TEXT_PLACEHOLDER}
        editing={editing}
        onEditingChange={onEditingChange}
        style={{ textAlign: alignOf(data) }}
        grab
        multiline
      />
      <Anchors />
    </div>
  );
}
