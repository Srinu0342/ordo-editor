import { useCallback } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  useInternalNode,
  useReactFlow,
} from "@xyflow/react";
import type { EdgeProps, EdgeTypes } from "@xyflow/react";
import { route, ROUTE_KEYS } from "./routers.ts";
import { markerUrl } from "./markers.tsx";
import { defaultEnds, nodeBox } from "./faces.ts";
import EditableLabel from "../nodes/EditableLabel.tsx";
// Aliased: in this file `OrdoEdge` is the component.
import type {
  LabelPlacement,
  OrdoEdge as OrdoEdgeType,
  OrdoNode,
} from "../types.ts";

// One component, parameterised by routing. Everything else arrives as style or
// data, which is why adding a marker or a dash pattern never adds a file.

// Where the label sits against the point the router hands back. On it is the
// default: a pill on the line. A sequence message wants its line left whole,
// so its label goes above; a self-message's router point is the far side of
// its loop, so its label goes to the right, clear of the loop.
const LABEL_GAP = 4;
const PLACE: Record<LabelPlacement, (x: number, y: number) => string> = {
  center: (x, y) => `translate(-50%, -50%) translate(${x}px, ${y}px)`,
  above: (x, y) => `translate(-50%, -100%) translate(${x}px, ${y - LABEL_GAP}px)`,
  right: (x, y) => `translate(0, -50%) translate(${x + LABEL_GAP}px, ${y}px)`,
};

function OrdoEdge({
  id,
  source,
  target,
  sourceHandleId,
  targetHandleId,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  style,
  routeKey,
}: EdgeProps<OrdoEdgeType> & { routeKey: string }) {
  // An end that names no handle would be drawn from the first anchor React
  // Flow finds, the top one, so two nodes side by side would be joined top to
  // top. Such an end takes the face that looks at the other node instead (see
  // edges/faces.ts), from the anchor that face would have if it were named. An
  // end that names its handle is drawn exactly where React Flow puts it.
  const sourceNode = useInternalNode<OrdoNode>(source);
  const targetNode = useInternalNode<OrdoNode>(target);
  const ends =
    sourceHandleId == null || targetHandleId == null
      ? defaultEnds(nodeBox(sourceNode), nodeBox(targetNode), {
          source: sourceHandleId != null,
          target: targetHandleId != null,
        })
      : {};

  const [edgePath, labelX, labelY] = route(routeKey, {
    sourceX: ends.source?.x ?? sourceX,
    sourceY: ends.source?.y ?? sourceY,
    sourcePosition: ends.source?.position ?? sourcePosition,
    targetX: ends.target?.x ?? targetX,
    targetY: ends.target?.y ?? targetY,
    targetPosition: ends.target?.position ?? targetPosition,
  });

  const { setEdges } = useReactFlow<OrdoNode, OrdoEdgeType>();
  const setLabel = useCallback(
    (label: string) =>
      setEdges((eds) =>
        eds.map((e) =>
          e.id === id ? { ...e, data: { ...e.data, label } } : e,
        ),
      ),
    [id, setEdges],
  );

  // Markers live in data rather than on the edge's markerStart/markerEnd props
  // so that both ends are plain strings the toolbar can set independently.
  const ms = markerUrl(data?.markerStart);
  const me = markerUrl(data?.markerEnd);
  const label = data?.label ?? "";
  const place = PLACE[data?.labelPlacement ?? "center"] ?? PLACE.center;

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={style}
        markerStart={ms}
        markerEnd={me}
      />

      {label !== "" && (
        <EdgeLabelRenderer>
          <EditableLabel
            value={label}
            onChange={setLabel}
            style={{
              position: "absolute",
              transform: place(labelX, labelY),
              fontSize: 11,
              fontFamily: "system-ui, sans-serif",
              pointerEvents: "all",
              // edges inside a subflow get an elevated z-index, which would
              // otherwise paint the line straight over this overlay
              zIndex: 1001,
              background: "#fff",
              border: "1px solid #cbd5e1",
              borderRadius: 999,
              padding: "2px 8px",
              lineHeight: 1.4,
            }}
          />
        </EdgeLabelRenderer>
      )}
    </>
  );
}

// React Flow resolves the component from edge.type, so each route gets a thin
// bound wrapper rather than the edge carrying its router in data.
export const edgeTypes = ROUTE_KEYS.reduce<EdgeTypes>((acc, key) => {
  const C = (props: EdgeProps<OrdoEdgeType>) => (
    <OrdoEdge {...props} routeKey={key} />
  );
  C.displayName = `OrdoEdge(${key})`;
  acc[key] = C;
  return acc;
}, {});

export default OrdoEdge;
