import { useCallback } from "react";
import { BaseEdge, EdgeLabelRenderer, useReactFlow } from "@xyflow/react";
import { route, ROUTE_KEYS } from "./routers.js";
import { markerUrl } from "./markers.jsx";
import EditableLabel from "../nodes/EditableLabel.jsx";

// One component, parameterised by routing. Everything else arrives as style or
// data, which is why adding a marker or a dash pattern never adds a file.

function OrdoEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  style,
  routeKey,
}) {
  const [edgePath, labelX, labelY] = route(routeKey, {
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const { setEdges } = useReactFlow();
  const setLabel = useCallback(
    (label) =>
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
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
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
export const edgeTypes = ROUTE_KEYS.reduce((acc, key) => {
  const C = (props) => <OrdoEdge {...props} routeKey={key} />;
  C.displayName = `OrdoEdge(${key})`;
  acc[key] = C;
  return acc;
}, {});

export default OrdoEdge;
