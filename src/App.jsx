import { useCallback, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
} from "@xyflow/react";

import Sidebar from "./components/Sidebar.jsx";
import Toolbar from "./components/Toolbar.jsx";
import ImportDialog from "./components/ImportDialog.jsx";
import { nodeTypes, GROUP_TYPES, makeNode, nodeSize } from "./nodes/index.js";
import { edgeTypes, EdgeMarkers } from "./edges/index.js";
import { DEFAULT_EDGE_STYLE, applyEdgeStyle, newEdge } from "./edgeStyle.js";
import { getMermaidLayoutForOrdo, toOrdo } from "./mermaid";

let seq = 0;
const nextId = () => `n${seq++}`;

const GRID = 10;

// --- group membership -------------------------------------------------------

// `inner` has to sit ENTIRELY inside `outer`. Swap this for a centre-point test
// if you would rather have partial overlap count as "inside".
const contains = (outer, inner) =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.width <= outer.x + outer.width &&
  inner.y + inner.height <= outer.y + outer.height;

const depthOf = (byId, id) => {
  let depth = 0;
  let cur = byId.get(id);
  while (cur?.parentId) {
    depth += 1;
    cur = byId.get(cur.parentId);
  }
  return depth;
};

// Keeps a group from being dropped into one of its own descendants.
const isDescendantOf = (byId, id, ancestorId) => {
  let cur = byId.get(id);
  while (cur?.parentId) {
    if (cur.parentId === ancestorId) return true;
    cur = byId.get(cur.parentId);
  }
  return false;
};

// React Flow requires a parent to appear BEFORE its children in the array.
const sortParentsFirst = (nodes) => {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const seen = new Set();
  const out = [];
  const visit = (n) => {
    if (!n || seen.has(n.id)) return;
    seen.add(n.id); // marked before recursing, so a bad cycle can't hang us
    visit(byId.get(n.parentId));
    out.push(n);
  };
  nodes.forEach(visit);
  return out;
};

const initialNodes = [];
const initialEdges = [];

function Flow() {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [panel, setPanel] = useState("nodes");
  const [edgeStyle, setEdgeStyle] = useState(DEFAULT_EDGE_STYLE);
  const [importOpen, setImportOpen] = useState(false);

  const { screenToFlowPosition, toObject, getInternalNode, fitView } =
    useReactFlow();

  const onConnect = useCallback(
    (c) => setEdges((eds) => addEdge(newEdge(c, edgeStyle), eds)),
    [setEdges, edgeStyle],
  );

  // Toolbar edits retarget: they hit the current edge selection if there is
  // one, and otherwise just move the default for the next edge drawn.
  const changeEdgeStyle = useCallback(
    (patch) => {
      const next = { ...edgeStyle, ...patch };
      setEdgeStyle(next);

      setEdges((eds) => {
        if (!eds.some((e) => e.selected)) return eds; // same ref, no re-render
        return eds.map((e) => (e.selected ? applyEdgeStyle(e, next) : e));
      });
    },
    [edgeStyle, setEdges],
  );

  // absolute (canvas) rect of a node, using its measured size
  const absRect = useCallback(
    (id) => {
      const internal = getInternalNode(id);
      if (!internal) return null;
      const { x, y } = internal.internals.positionAbsolute;
      return {
        x,
        y,
        width: internal.measured?.width ?? 0,
        height: internal.measured?.height ?? 0,
      };
    },
    [getInternalNode],
  );

  // innermost group that fully contains `rect`. `skipId` and everything nested
  // under it are ignored, so a group can never become its own ancestor.
  const groupAt = useCallback(
    (rect, allNodes, skipId) => {
      const byId = new Map(allNodes.map((n) => [n.id, n]));
      let best = null;
      let bestDepth = -1;

      for (const n of allNodes) {
        if (!GROUP_TYPES.has(n.type)) continue;
        if (n.id === skipId) continue;
        if (skipId && isDescendantOf(byId, n.id, skipId)) continue;

        const groupRect = absRect(n.id);
        if (!groupRect || !contains(groupRect, rect)) continue;

        const depth = depthOf(byId, n.id);
        if (depth > bestDepth) {
          best = n;
          bestDepth = depth;
        }
      }
      return best;
    },
    [absRect],
  );

  // flags exactly one group (or none) as the live drop target. The flag is
  // transient, so it's deleted rather than set to false — nothing leaks into
  // `toObject()` once the drag is over.
  const markDropTarget = useCallback(
    (targetId) => {
      setNodes((nds) => {
        let changed = false;

        const next = nds.map((n) => {
          if (!GROUP_TYPES.has(n.type)) return n;

          const isTarget = n.id === targetId;
          if (Boolean(n.data.isDropTarget) === isTarget) return n;

          changed = true;
          const { isDropTarget: _stale, ...data } = n.data;
          return {
            ...n,
            data: isTarget ? { ...data, isDropTarget: true } : data,
          };
        });

        // same reference when nothing moved, so React skips the re-render
        return changed ? next : nds;
      });
    },
    [setNodes],
  );

  // live feedback: highlight the group the node would land in
  const onNodeDrag = useCallback(
    (_event, node) => {
      const rect = absRect(node.id);
      const parent = rect ? groupAt(rect, nodes, node.id) : null;
      markDropTarget(parent && parent.id !== node.parentId ? parent.id : null);
    },
    [absRect, groupAt, nodes, markDropTarget],
  );

  // THE commit: adopt into a group, move between groups, or release entirely
  const onNodeDragStop = useCallback(
    (_event, _node, draggedNodes) => {
      markDropTarget(null); // queued first, so the flag is gone before we re-parent

      setNodes((nds) => {
        const moved = new Set(draggedNodes.map((n) => n.id));
        let changed = false;

        const next = nds.map((n) => {
          if (!moved.has(n.id)) return n;

          const rect = absRect(n.id);
          if (!rect) return n;

          const parent = groupAt(rect, nds, n.id);
          const parentId = parent?.id;
          if ((n.parentId ?? undefined) === parentId) return n; // no change

          changed = true;
          const origin = parent ? absRect(parent.id) : { x: 0, y: 0 };
          const { parentId: _released, ...rest } = n;
          return {
            ...rest,
            ...(parentId && { parentId }),
            // re-express the position against its new frame of reference
            position: { x: rect.x - origin.x, y: rect.y - origin.y },
          };
        });

        return changed ? sortParentsFirst(next) : nds;
      });
    },
    [setNodes, absRect, groupAt, markDropTarget],
  );

  // The dialog collects the source; the extractor turns it into a Mermaid
  // layout; `toOrdo` restates that layout in our own vocabulary. Import
  // REPLACES the canvas rather than merging — a half-merged diagram is worse
  // than either outcome, and undo still gets you back.
  const onMermaidText = useCallback(
    (source, { fileName }) => {
      const graphId = `mermaid-${Math.random().toString(36).slice(2)}`;

      console.log({ graphId });

      getMermaidLayoutForOrdo(source, graphId)
        .then((layout) => {
          if (!layout) {
            console.error("Mermaid import: no layout returned", { fileName });
            return;
          }

          const { nodes: imported, edges: importedEdges, unsupported } =
            toOrdo(layout);

          if (unsupported.length) {
            console.warn(
              "Mermaid import: drawn as rectangles, no Ordo shape for",
              unsupported,
            );
          }

          setNodes(imported);
          setEdges(importedEdges);

          // one frame, so the nodes are measured before the viewport is fitted
          requestAnimationFrame(() => fitView({ padding: 0.2 }));
        })
        .catch((error) => {
          console.error("Mermaid import failed", error);
        });
    },
    [setNodes, setEdges, fitView],
  );

  const onDragOver = useCallback((event) => {
    event.preventDefault(); // required, or the drop never fires
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (event) => {
      event.preventDefault();
      const kind = event.dataTransfer.getData("application/ordo");
      if (!kind) return;

      // THE conversion: mouse pixels → flow coordinates
      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      setNodes((nds) => {
        // A palette drop is hit-tested before the node has mounted, so its size
        // comes from the registry default. Every drag after that uses the real
        // measured size.
        const [width, height] = nodeSize(kind);
        const parent = groupAt({ ...position, width, height }, nds, null);
        const origin = parent ? absRect(parent.id) : null;

        return sortParentsFirst(
          nds.concat(
            makeNode(kind, {
              id: nextId(),
              // a child's position is relative to its parent's top-left
              position: origin
                ? { x: position.x - origin.x, y: position.y - origin.y }
                : position,
              parentId: parent?.id,
            }),
          ),
        );
      });
    },
    [screenToFlowPosition, setNodes, groupAt, absRect],
  );

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100vw",
        height: "100vh",
      }}
    >
      <Toolbar
        value={edgeStyle}
        onChange={changeEdgeStyle}
        selectedCount={edges.reduce((n, e) => n + (e.selected ? 1 : 0), 0)}
        onImport={() => setImportOpen(true)}
      />

      <ImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImport={onMermaidText}
      />

      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <Sidebar
          panel={panel}
          onPanelChange={setPanel}
          route={edgeStyle.route}
          onRouteChange={(route) => changeEdgeStyle({ route })}
          onInspect={() => console.log("Details:", toObject())}
        />

        <div
          style={{ flex: 1, position: "relative" }}
          onDrop={onDrop}
          onDragOver={onDragOver}
        >
          {/* marker <defs> mounted once; edges reference them by url(#id) */}
          <EdgeMarkers />

          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeDrag={onNodeDrag}
            onNodeDragStop={onNodeDragStop}
            connectionMode="loose"
            fitView={initialNodes.length > 0}
            snapToGrid
            snapGrid={[GRID, GRID]}
            deleteKeyCode={["Backspace", "Delete"]}
          >
            <Background variant="lines" gap={GRID} size={1} />
            <MiniMap />
            <Controls />
          </ReactFlow>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ReactFlowProvider>
      <Flow />
    </ReactFlowProvider>
  );
}
