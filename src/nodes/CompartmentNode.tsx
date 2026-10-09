import { useCallback } from "react";
import type { CSSProperties } from "react";
import { useReactFlow, NodeResizer } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";
import EditableLabel from "./EditableLabel.tsx";
import { Anchors, useNodeTheme } from "./chrome.tsx";
import type { NodeData, OrdoEdge, OrdoNode } from "../types.ts";

// Stacked sections with independent content — UML class, ER entity, record.
//
// This is the component that forces the authored-vs-intrinsic sizing question,
// which is WS3's most consequential hand-back to WS2's write-back layer. Height
// here is INTRINSIC: it comes from the row count, not from the document. A drag
// on the resizer can widen it but not shorten it below its content, so the
// engine has to decide whether the resulting height is a fact to persist or a
// derived value to recompute. Both answers are defensible; the point is that
// building only Box and Container lets the question stay unasked.

const rowStyle: CSSProperties = {
  padding: "3px 9px",
  fontSize: 12.5,
  fontFamily: "system-ui, sans-serif",
  display: "flex",
};

export default function CompartmentNode({
  id,
  data,
  selected,
}: NodeProps<OrdoNode>) {
  const { setNodes } = useReactFlow<OrdoNode, OrdoEdge>();
  const theme = useNodeTheme(selected);
  const sections = data.sections ?? [["field: type"], ["method()"]];

  const patch = useCallback(
    (fn: (data: NodeData) => NodeData) =>
      setNodes((nds) =>
        nds.map((nd) => (nd.id === id ? { ...nd, data: fn(nd.data) } : nd)),
      ),
    [id, setNodes],
  );

  const setRow = (si: number, ri: number, value: string) =>
    patch((d) => {
      const next = (d.sections ?? sections).map((s) => s.slice());
      next[si][ri] = value;
      return { ...d, sections: next };
    });

  const addRow = (si: number) =>
    patch((d) => {
      const next = (d.sections ?? sections).map((s) => s.slice());
      next[si].push("");
      return { ...d, sections: next };
    });

  return (
    <>
      <NodeResizer
        isVisible={selected}
        minWidth={120}
        color={theme["node.stroke.selected"]}
      />
      <div
        style={{
          width: "100%",
          boxSizing: "border-box",
          border: `1.5px solid ${theme["node.stroke"]}`,
          background: theme["node.fill"],
          borderRadius: 3,
          overflow: "hidden",
          position: "relative",
          color: theme["node.ink"],
        }}
      >
        <div
          style={{
            ...rowStyle,
            justifyContent: "center",
            fontWeight: 700,
            fontSize: 13.5,
            padding: "5px 9px",
            borderBottom: `1.5px solid ${theme["node.stroke"]}`,
            background: theme["node.shade"],
          }}
        >
          <EditableLabel
            value={data.label ?? ""}
            onChange={(v) => patch((d) => ({ ...d, label: v }))}
            placeholder="ClassName"
          />
        </div>

        {sections.map((rows, si) => (
          <div
            key={si}
            onDoubleClick={(e) => {
              // double-click on the section's empty space adds a row; on a row
              // itself EditableLabel stops propagation first
              if (e.target === e.currentTarget) addRow(si);
            }}
            style={{
              borderBottom:
                si < sections.length - 1
                  ? `1.5px solid ${theme["node.stroke"]}`
                  : "none",
              padding: "3px 0",
              minHeight: 22,
            }}
          >
            {rows.map((row, ri) => (
              <div key={ri} style={rowStyle}>
                <EditableLabel
                  value={row}
                  onChange={(v) => setRow(si, ri, v)}
                  placeholder="—"
                />
              </div>
            ))}
          </div>
        ))}
        <Anchors />
      </div>
    </>
  );
}
