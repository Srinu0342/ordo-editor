import { useCallback, useEffect, useRef, useState } from "react";
import type { DragEvent, PointerEvent } from "react";
import {
  BackgroundVariant,
  ConnectionMode,
  SelectionMode,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  useNodesInitialized,
  addEdge,
} from "@xyflow/react";
import type {
  NodeChange,
  NodePositionChange,
  OnConnect,
  OnNodeDrag,
  OnNodesChange,
  XYPosition,
} from "@xyflow/react";
import { ToastContainer } from "react-toastify";

import Sidebar from "./components/Sidebar.tsx";
import Toolbar from "./components/Toolbar.tsx";
import ImportDialog from "./components/ImportDialog.tsx";
import type { ImportDescription } from "./components/ImportDialog.tsx";
import OrdoImportDialog from "./components/OrdoImportDialog.tsx";
import type { OrdoImportResult } from "./components/OrdoImportDialog.tsx";
import ViewYamlDialog from "./components/ViewYamlDialog.tsx";
import AlignmentGuides from "./components/AlignmentGuides.tsx";
import type { Panel } from "./components/Sidebar.tsx";
import { alignRect, GUIDE_SNAP_PX } from "./alignment.ts";
import type { Guide } from "./alignment.ts";
import {
  nodeTypes,
  GROUP_TYPES,
  makeNode,
  nodeSize,
  sizeOfNode,
  isUnparented,
  TubeFollower,
  TUBE_TYPE,
} from "./nodes/index.ts";
import {
  nearestEdge,
  nearestOnPath,
  edgePathEl,
  edgesTouching,
  SNAP_DIST,
  DETACH_DIST,
} from "./edges/attach.ts";
import { edgeTypes, EdgeMarkers } from "./edges/index.ts";
import { DEFAULT_EDGE_STYLE, applyEdgeStyle } from "./edgeStyle.ts";
import type { EdgeStyle } from "./edgeStyle.ts";
import {
  IMPORTABLE,
  detectDiagram,
  diagramName,
  groupDiagram,
  groupId,
  importMermaid,
} from "./mermaid/index.ts";
import {
  copySelection,
  cloneGraph,
  unionRect,
  selectedIds,
  withDescendants,
  sortParentsFirst,
} from "./selection.ts";
import type { Clip } from "./selection.ts";
import { useHistory, isTyping } from "./useHistory.ts";
import { useColorScheme } from "./colorScheme.ts";
import type { Scheme } from "./colorScheme.ts";
import { THEMES } from "./theme.ts";
import { ThemeContext, useCanvasTheme } from "./nodes/chrome.tsx";
import { detectKind, emptySession, idMinter, mintId } from "./ordo/index.ts";
import type { OrdoSession } from "./ordo/index.ts";
import { connectionEdge } from "./ordo/rf-mapping.ts";
import type { Attach, OrdoEdge, OrdoNode, Rect, XY } from "./types.ts";

// Every id in play, nodes and edges together: the Ordo format keeps the two in
// one namespace, and new ones are minted n<k> / e<k>, one above the highest in
// use (see ordo/ids.ts).
const idsOf = (nodes: { id: string }[], edges: { id: string }[]) => [
  ...nodes.map((n) => n.id),
  ...edges.map((e) => e.id),
];

const GRID = 10;

// fitPending's value for "frame the whole canvas" rather than one group.
const FIT_ALL = "\u0000all";

// What the import dialog shows the moment text lands in it: the diagram type
// Mermaid reads it as, and whether there is an importer for that type. A type
// Mermaid knows and Ordo cannot import yet also carries a warning, which the
// dialog raises as a toast. Text that is not Mermaid at all has no type to
// warn about; its label says so.
const describeMermaid = (text: string): ImportDescription => {
  // An Ordo .yml file is YAML, not Mermaid; say where it goes instead.
  if (detectKind(text))
    return { ok: false, label: "This is an Ordo .yml file — use Import  Ordo YAML", warning: null };
  const found = detectDiagram(text);
  return {
    ok: Boolean(found.family),
    label:
      found.blocks > 1
        ? `${found.label} (first of ${found.blocks} diagrams)`
        : found.label,
    warning:
      found.type && !found.family
        ? `${found.name} is not supported yet. ${IMPORTABLE}`
        : null,
  };
};

// Where a paste lands when the pointer is off-canvas (keyboard-only paste) and
// what a duplicate is nudged by. Grid-aligned, so pasted nodes stay snapped.
const PASTE_NUDGE = 2 * GRID;

// Between an imported diagram and whatever is already on the canvas.
const IMPORT_GAP = 8 * GRID;

const snap = (v: number) => Math.round(v / GRID) * GRID;

// --- group membership -------------------------------------------------------

// `inner` has to sit ENTIRELY inside `outer`. Swap this for a centre-point test
// if you would rather have partial overlap count as "inside".
const contains = (outer: Rect, inner: Rect) =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.width <= outer.x + outer.width &&
  inner.y + inner.height <= outer.y + outer.height;

const depthOf = (byId: Map<string, OrdoNode>, id: string) => {
  let depth = 0;
  let cur = byId.get(id);
  while (cur?.parentId) {
    depth += 1;
    cur = byId.get(cur.parentId);
  }
  return depth;
};

// Keeps a group from being dropped into one of its own descendants.
const isDescendantOfAny = (
  byId: Map<string, OrdoNode>,
  id: string,
  ancestorIds: Set<string>,
) => {
  let cur = byId.get(id);
  while (cur?.parentId) {
    if (ancestorIds.has(cur.parentId)) return true;
    cur = byId.get(cur.parentId);
  }
  return false;
};

const initialNodes: OrdoNode[] = [];
const initialEdges: OrdoEdge[] = [];

function Flow({
  scheme,
  onToggleScheme,
}: {
  scheme: Scheme;
  onToggleScheme: () => void;
}) {
  const theme = useCanvasTheme();
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [panel, setPanel] = useState<Panel>("nodes");
  const [edgeStyle, setEdgeStyle] = useState(DEFAULT_EDGE_STYLE);
  const [importOpen, setImportOpen] = useState(false);
  const [yamlImportOpen, setYamlImportOpen] = useState(false);
  const [yamlViewOpen, setYamlViewOpen] = useState(false);
  const importYamlRef = useRef<HTMLButtonElement>(null);
  const viewYamlRef = useRef<HTMLButtonElement>(null);

  // The Ordo session, next to the canvas state: the documents of the last
  // Ordo import or export, which the next export patches. Any other way of
  // replacing the canvas (a Mermaid import) clears them, so an unrelated
  // file's comments never leak into a new diagram.
  const [session, setSession] = useState<OrdoSession>(() => emptySession());
  const [guides, setGuides] = useState<Guide[]>([]);

  const { screenToFlowPosition, toObject, getInternalNode, fitView, getZoom } =
    useReactFlow<OrdoNode, OrdoEdge>();

  // Window-level shortcuts read the graph through refs: binding the listener to
  // `nodes` would re-subscribe on every drag frame for no gain.
  const graphRef = useRef({ nodes, edges });
  graphRef.current = { nodes, edges };

  // Undo and redo, kept as diffs between states of the graph. Every write lands
  // in these two lists, whoever made it, so history watches them rather than
  // each writer.
  const { undo, redo } = useHistory({ nodes, edges, setNodes, setEdges });

  // Last pointer position over the canvas, in flow coordinates. Null whenever
  // the pointer is outside, which is what makes "paste where I'm pointing"
  // degrade cleanly into "paste slightly offset".
  const pointerRef = useRef<XYPosition | null>(null);
  const clipboardRef = useRef<Clip | null>(null);

  // A drawn edge gets an e<k> id, and is built by rfEdge whenever the toolbar's
  // style is one Ordo v1 can store (see connectionEdge).
  const onConnect = useCallback<OnConnect>(
    (c) =>
      setEdges((eds) =>
        addEdge(
          connectionEdge(c, mintId("e", idsOf(graphRef.current.nodes, eds)), edgeStyle),
          eds,
        ),
      ),
    [setEdges, edgeStyle],
  );

  // Toolbar edits retarget: they hit the current edge selection if there is
  // one, and otherwise just move the default for the next edge drawn.
  const changeEdgeStyle = useCallback(
    (patch: Partial<EdgeStyle>) => {
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
    (id: string): Rect | null => {
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

  // Alignment guides. Drag frames are intercepted BEFORE React Flow applies
  // them: the moving selection is lined up as one box against every node that
  // is not travelling with it, and the same nudge is added to each dragged
  // position so the selection keeps its shape. Grid snap has already run by
  // now, so an alignment wins over the grid — that is the point of asking.
  const onNodesChangeAligned = useCallback<OnNodesChange<OrdoNode>>(
    (changes) => {
      const drags = changes.filter(
        (c): c is NodePositionChange & { position: XYPosition } =>
          c.type === "position" && Boolean(c.dragging && c.position),
      );
      if (!drags.length) {
        onNodesChange(changes);
        return;
      }

      // Where each dragged node WOULD land, in absolute coordinates. Its
      // parent is not moving (React Flow drops children of a moving parent),
      // so last frame's parent offset still holds.
      const offsets = new Map<string, XY>();
      const landing: Rect[] = [];
      for (const c of drags) {
        const internal = getInternalNode(c.id);
        if (!internal) continue;
        const abs = internal.internals.positionAbsolute;
        const off = {
          x: abs.x - internal.position.x,
          y: abs.y - internal.position.y,
        };
        offsets.set(c.id, off);
        landing.push({
          x: c.position.x + off.x,
          y: c.position.y + off.y,
          width: internal.measured?.width ?? 0,
          height: internal.measured?.height ?? 0,
        });
      }

      const moving = withDescendants(
        graphRef.current.nodes,
        new Set(drags.map((c) => c.id)),
      );
      const others: Rect[] = [];
      for (const n of graphRef.current.nodes) {
        if (moving.has(n.id) || n.hidden) continue;
        const r = absRect(n.id);
        if (r && r.width && r.height) others.push(r);
      }

      const box = unionRect(landing);
      const { dx, dy, guides: next } = box
        ? alignRect(box, others, GUIDE_SNAP_PX / getZoom())
        : { dx: 0, dy: 0, guides: [] };

      setGuides(next);
      onNodesChange(
        dx || dy
          ? changes.map((c): NodeChange<OrdoNode> =>
              c.type === "position" && offsets.has(c.id) && c.dragging && c.position
                ? {
                    ...c,
                    position: { x: c.position.x + dx, y: c.position.y + dy },
                  }
                : c,
            )
          : changes,
      );
    },
    [onNodesChange, getInternalNode, absRect, getZoom],
  );

  // innermost group that fully contains `rect`. Everything in `skipIds`, and
  // everything nested under it, is ignored — so a group can never become its
  // own ancestor, and a group being dragged can never adopt its travelling
  // companions mid-flight.
  const groupAt = useCallback(
    (
      rect: Rect | null,
      allNodes: OrdoNode[],
      skipIds = new Set<string>(),
    ): OrdoNode | null => {
      if (!rect) return null;

      const byId = new Map(allNodes.map((n) => [n.id, n]));
      let best: OrdoNode | null = null;
      let bestDepth = -1;

      for (const n of allNodes) {
        if (!GROUP_TYPES.has(n.type)) continue;
        if (skipIds.has(n.id)) continue;
        if (isDescendantOfAny(byId, n.id, skipIds)) continue;

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

  // THE multi-drag rule. A COHERENT selection — every dragged node came out of
  // the same frame — gets ONE decision, taken on the union of their rects, so
  // the group either swallows the whole selection or none of it. A mixed
  // selection is hit-tested per node instead: there is no single honest answer
  // for it, and re-homing everything to the union's target would yank nodes out
  // of groups the user never dragged near.
  //
  // A single-node drag is trivially coherent, so this reduces to the old
  // one-node behaviour without a special case.
  const dropTargets = useCallback(
    (draggedNodes: OrdoNode[], allNodes: OrdoNode[]) => {
      const byId = new Map(allNodes.map((n) => [n.id, n]));
      // Everything moving is skipped when hit-testing, including the riders
      // that are about to be excluded from adoption — a group must not adopt
      // itself, whatever the travelling node turns out to be.
      const skipIds = new Set(draggedNodes.map((n) => n.id));
      const adoptable = draggedNodes.filter((n) => !isUnparented(n));

      const rects = new Map<string, Rect>();
      for (const n of adoptable) {
        const rect = absRect(n.id);
        if (rect) rects.set(n.id, rect);
      }

      const parents = new Set(
        adoptable.map((n) => byId.get(n.id)?.parentId ?? null),
      );
      const coherent = parents.size === 1 && rects.size === adoptable.length;

      const targets = new Map<string, OrdoNode | null>();
      if (coherent) {
        const shared = groupAt(
          unionRect([...rects.values()]),
          allNodes,
          skipIds,
        );
        for (const id of rects.keys()) targets.set(id, shared);
      } else {
        for (const [id, rect] of rects) {
          targets.set(id, groupAt(rect, allNodes, skipIds));
        }
      }
      return targets;
    },
    [absRect, groupAt],
  );

  // flags the live drop targets. The flag is transient, so it's deleted rather
  // than set to false — nothing leaks into `toObject()` once the drag is over.
  const markDropTargets = useCallback(
    (targetIds: Set<string>) => {
      setNodes((nds) => {
        let changed = false;

        const next = nds.map((n) => {
          if (!GROUP_TYPES.has(n.type)) return n;

          const isTarget = targetIds.has(n.id);
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

  const centreOf = useCallback(
    (id: string) => {
      const r = absRect(id);
      return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
    },
    [absRect],
  );

  // Writes `attach` onto some nodes and strips it from others in one pass, so a
  // tube that hops from one edge to another never exists in both states.
  const setAttachments = useCallback(
    (attachments: Map<string, Attach>, released: Set<string>) => {
      if (!attachments.size && !released.size) return;

      setNodes((nds) => {
        let changed = false;

        const next = nds.map((n) => {
          if (released.has(n.id)) {
            if (!n.data?.attach) return n;
            changed = true;
            const { attach: _gone, ...data } = n.data;
            return { ...n, data };
          }

          const attach = attachments.get(n.id);
          if (!attach) return n;
          changed = true;
          return { ...n, data: { ...n.data, attach } };
        });

        // React Flow reports a dragged node with the data it had when the drag
        // began, so a release is asked for again on every frame after the
        // first. Same reference when nothing actually changed, or the canvas
        // re-renders for the rest of the drag over a decision already taken.
        return changed ? next : nds;
      });
    },
    [setNodes],
  );

  // Pulling a rider clear of its edge releases it — mid-drag, not on drop, so
  // you can see the moment it lets go rather than discovering it afterwards.
  // DETACH_DIST is larger than the snap radius on purpose: an attached tube
  // nudged by a pixel must not flicker between held and free.
  const releasePulledAway = useCallback(
    (draggedNodes: OrdoNode[]) => {
      const released = new Set<string>();

      for (const node of draggedNodes) {
        const attach = node.data?.attach;
        if (!attach) continue;

        const centre = centreOf(node.id);
        const hit = centre
          ? nearestOnPath(edgePathEl(attach.edgeId), centre)
          : null;
        if (!hit || hit.dist > DETACH_DIST) released.add(node.id);
      }

      setAttachments(new Map(), released);
    },
    [centreOf, setAttachments],
  );

  // live feedback: highlight the group(s) the selection would land in
  const onNodeDrag = useCallback<OnNodeDrag<OrdoNode>>(
    (_event, _node, draggedNodes) => {
      const byId = new Map(nodes.map((n) => [n.id, n]));
      const live = new Set<string>();

      for (const [id, target] of dropTargets(draggedNodes, nodes)) {
        if (target && target.id !== (byId.get(id)?.parentId ?? undefined)) {
          live.add(target.id);
        }
      }
      markDropTargets(live);
      releasePulledAway(draggedNodes);
    },
    [dropTargets, nodes, markDropTargets, releasePulledAway],
  );

  // Where a rider ends up. Dropped within reach of an edge it grabs on at the
  // nearest point; dropped anywhere else it is simply a node again.
  //
  // Edges that END on something being dragged are excluded: they move with the
  // tube, so a tube attached to its own edge would chase a point that is
  // chasing it back and the pair would never come to rest.
  const settleRiders = useCallback(
    (draggedNodes: OrdoNode[]) => {
      const riders = draggedNodes.filter((n) => n.type === TUBE_TYPE);
      if (!riders.length) return;

      const { edges: eds } = graphRef.current;
      const moving = new Set(draggedNodes.map((n) => n.id));
      const ownEdges = edgesTouching(eds, moving);

      const attachments = new Map<string, Attach>();
      const released = new Set<string>();

      for (const rider of riders) {
        const centre = centreOf(rider.id);
        const hit = centre
          ? nearestEdge(eds, centre, SNAP_DIST, ownEdges)
          : null;

        if (hit) {
          // Dropped back on the edge it was riding, a rider keeps its sideways
          // offset: a nested activation moved along its lifeline stays nested.
          const was = rider.data?.attach;
          attachments.set(rider.id, {
            edgeId: hit.edgeId,
            t: hit.t,
            angle: hit.angle,
            ...(was?.shift && was.edgeId === hit.edgeId
              ? { shift: was.shift }
              : {}),
          });
        } else {
          released.add(rider.id);
        }
      }

      setAttachments(attachments, released);
    },
    [centreOf, setAttachments],
  );

  // THE commit: adopt into a group, move between groups, or release entirely.
  //
  // `draggedNodes` is the whole moving selection, whether it was grabbed by one
  // of its members or by the rubber-band overlay — React Flow reports both
  // through here, and already drops children whose parent is moving too, so
  // nothing double-counts them.
  const onNodeDragStop = useCallback<OnNodeDrag<OrdoNode>>(
    (_event, _node, draggedNodes) => {
      // queued first, so the flag is gone before we re-parent
      markDropTargets(new Set());
      setGuides([]);

      setNodes((nds) => {
        const targets = dropTargets(draggedNodes, nds);
        let changed = false;

        const next = nds.map((n) => {
          if (!targets.has(n.id)) return n;

          const rect = absRect(n.id);
          if (!rect) return n;

          const parent = targets.get(n.id);
          const parentId = parent?.id;
          if ((n.parentId ?? undefined) === parentId) return n; // no change

          changed = true;
          // groupAt only ever picks a group it could measure
          const origin = parent ? absRect(parent.id)! : { x: 0, y: 0 };
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

      settleRiders(draggedNodes);
    },
    [setNodes, absRect, dropTargets, markDropTargets, settleRiders],
  );

  // --- clipboard ------------------------------------------------------------

  const copy = useCallback(() => {
    const { nodes: nds, edges: eds } = graphRef.current;
    const clip = copySelection({ nodes: nds, edges: eds, absRect });
    if (clip) clipboardRef.current = clip;
    return clip;
  }, [absRect]);

  // Pastes a payload and hands the selection to the copies. `dx`/`dy` move the
  // roots; children ride along inside their parents, so a group's internals are
  // never re-laid-out by a paste.
  const paste = useCallback(
    (clip: Clip, { dx, dy }: { dx: number; dy: number }) => {
      if (!clip?.nodes.length) return;

      const mint = idMinter(idsOf(graphRef.current.nodes, graphRef.current.edges));
      const fresh = cloneGraph(clip, {
        newNodeId: mint.node,
        newEdgeId: mint.edge,
        dx,
        dy,
      });

      setNodes((nds) => {
        const landing = new Set(fresh.nodes.map((n) => n.id));

        // Roots are hit-tested exactly like a palette drop: paste into a group
        // and the copies belong to it, paste onto open canvas and they don't.
        const placed = fresh.nodes.map((n) => {
          if (n.parentId || isUnparented(n)) return n;

          const [width, height] = sizeOfNode(n);
          const parent = groupAt(
            { ...n.position, width, height },
            nds,
            landing,
          );
          if (!parent) return n;

          const origin = absRect(parent.id) ?? { x: 0, y: 0 };
          return {
            ...n,
            parentId: parent.id,
            position: {
              x: n.position.x - origin.x,
              y: n.position.y - origin.y,
            },
          };
        });

        const cleared = nds.map((n) =>
          n.selected ? { ...n, selected: false } : n,
        );
        return sortParentsFirst(cleared.concat(placed));
      });

      setEdges((eds) =>
        eds
          .map((e) => (e.selected ? { ...e, selected: false } : e))
          .concat(fresh.edges),
      );
    },
    [setNodes, setEdges, groupAt, absRect],
  );

  // Paste lands under the pointer when there is one — the clipboard's own
  // bounding box is moved to the cursor, so a multi-node paste keeps its
  // internal spacing and arrives where you are looking.
  const pasteFromClipboard = useCallback(() => {
    const clip = clipboardRef.current;
    if (!clip) return;

    const at = pointerRef.current;
    paste(clip, {
      dx: at ? snap(at.x - clip.bounds.x) : PASTE_NUDGE,
      dy: at ? snap(at.y - clip.bounds.y) : PASTE_NUDGE,
    });
  }, [paste]);

  // The other half of a cut. Removes exactly what the copy captured — the
  // selection plus everything nested under it — and every edge that just lost
  // an end, because an edge pointing at a node that is gone is not an edge.
  //
  // A selected edge between two nodes that STAY is left alone: the clipboard
  // could not carry it (both ends have to travel for a paste to reconnect it),
  // so cutting it would be a deletion dressed up as a move. Delete still does
  // what Delete does.
  const removeCopied = useCallback(() => {
    const gone = withDescendants(
      graphRef.current.nodes,
      selectedIds(graphRef.current.nodes),
    );
    if (!gone.size) return;

    setNodes((nds) => nds.filter((n) => !gone.has(n.id)));
    setEdges((eds) =>
      eds.filter((e) => !gone.has(e.source) && !gone.has(e.target)),
    );
  }, [setNodes, setEdges]);

  // Ctrl/Cmd chords. React Flow's own deleteKeyCode still handles Delete; these
  // are the ones it has no opinion about.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      if (isTyping(event.target)) return; // a label being edited owns its keys

      const key = event.key.toLowerCase();

      // Shift turns undo into redo. Both wait out a held pointer, and close an
      // edit still open before they move (see useHistory).
      if (key === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }

      if (key === "c") {
        if (copy()) event.preventDefault();
        return;
      }

      if (key === "x") {
        if (copy()) {
          removeCopied();
          event.preventDefault();
        }
        return;
      }

      if (key === "v") {
        event.preventDefault();
        pasteFromClipboard();
        return;
      }

      // Duplicate is a copy/paste that leaves the clipboard alone — you should
      // be able to duplicate something without losing what you had copied.
      if (key === "d") {
        event.preventDefault();
        const clip = copySelection({ ...graphRef.current, absRect });
        if (clip) paste(clip, { dx: PASTE_NUDGE, dy: PASTE_NUDGE });
        return;
      }

      if (key === "a") {
        event.preventDefault();
        setNodes((nds) => nds.map((n) => ({ ...n, selected: true })));
        setEdges((eds) => eds.map((e) => ({ ...e, selected: true })));
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    copy,
    paste,
    pasteFromClipboard,
    removeCopied,
    absRect,
    setNodes,
    setEdges,
    undo,
    redo,
  ]);

  // After an import the viewport is fitted to it once EVERY new node has been
  // measured. A fit fires on the first measurement it sees and frames only the
  // nodes measured by then — and a tube re-measuring its own handles gets in
  // first, so an early fit frames one lifeline and leaves the rest off-screen.
  const nodesInitialized = useNodesInitialized();
  const fitPending = useRef<string | null>(null);
  useEffect(() => {
    const id = fitPending.current;
    if (!id || !nodesInitialized) return;
    fitPending.current = null;
    fitView(id === FIT_ALL ? { padding: 0.2 } : { nodes: [{ id }], padding: 0.2 });
  }, [nodesInitialized, fitView]);

  // Where the next import lands: to the right of everything already on the
  // canvas, top-aligned with it, so diagrams queue up side by side instead of
  // landing on each other.
  const besideContent = useCallback(() => {
    const rects = graphRef.current.nodes
      .filter((n) => !n.parentId)
      .map((n) => {
        const [width, height] = sizeOfNode(n);
        const r = absRect(n.id);
        return r
          ? { ...r, width: r.width || width, height: r.height || height }
          : { ...n.position, width, height };
      });
    const box = unionRect(rects);
    return box
      ? { x: snap(box.x + box.width + IMPORT_GAP), y: snap(box.y) }
      : { x: 0, y: 0 };
  }, [absRect]);

  // The dialog collects the source; `importMermaid` reads what KIND of diagram
  // it is and hands it to the one importer for that kind — dagre's layout for
  // a flowchart, Ordo's own rows and columns for a sequence diagram. The
  // diagram is ADDED to the canvas as one group, named for its title or as the
  // next mermaidN, so it can be selected and moved as a unit. It arrives
  // selected. A failure is thrown back to the dialog, which keeps it on screen.
  const onMermaidText = useCallback(
    async (source: string, { fileName }: { fileName: string }) => {
      const result = await importMermaid(source);

      if (result.warnings.length) {
        console.warn(
          `Mermaid import (${result.type}${fileName ? `, ${fileName}` : ""}):`,
          result.warnings,
        );
      }

      const present = graphRef.current.nodes;
      const id = groupId(present);
      const { nodes: grouped, edges: wired } = groupDiagram(result, {
        id,
        label: diagramName(result.title, present),
        at: besideContent(),
        data: { mermaid: result.type },
      });

      setNodes((nds) => [
        ...nds.map((n) => (n.selected ? { ...n, selected: false } : n)),
        ...grouped.map((n) => (n.id === id ? { ...n, selected: true } : n)),
      ]);
      setSession((s) => ({ ...s, ordo: null, layout: null }));
      setEdges((eds) => [
        ...eds.map((e) => (e.selected ? { ...e, selected: false } : e)),
        ...wired,
      ]);
      fitPending.current = id;
    },
    [setNodes, setEdges, besideContent],
  );

  // An Ordo import REPLACES the canvas (one undo step, like any other write),
  // becomes the session the next View Ordo YAML patches, and is framed once every
  // node has been measured.
  const onOrdoImport = useCallback(
    ({ nodes: nds, edges: eds, ordo, layout, name }: OrdoImportResult) => {
      setNodes(nds);
      setEdges(eds);
      setSession({ name, ordo, layout });
      fitPending.current = FIT_ALL;
    },
    [setNodes, setEdges],
  );

  const onOrdoExported = useCallback(
    ({ ordo, layout }: Pick<OrdoSession, "ordo" | "layout">) =>
      setSession((s) => ({ ...s, ordo, layout })),
    [],
  );

  // Both Ordo dialogs hand focus back to the button that opened them.
  const closeYamlImport = useCallback(() => {
    setYamlImportOpen(false);
    importYamlRef.current?.focus();
  }, []);
  const closeYamlView = useCallback(() => {
    setYamlViewOpen(false);
    viewYamlRef.current?.focus();
  }, []);

  const onDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault(); // required, or the drop never fires
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const kind = event.dataTransfer.getData("application/ordo");
      if (!kind) return;

      // THE conversion: mouse pixels → flow coordinates
      const client = { x: event.clientX, y: event.clientY };
      const position = screenToFlowPosition(client);

      // A rider lands on a path, not on the grid. The snap that keeps ordinary
      // nodes tidy would move the drop by up to half a cell before the edge is
      // hit-tested, which is enough to attach it beside the point you aimed at.
      const exact = screenToFlowPosition(client, { snapToGrid: false });

      // A palette drop is hit-tested before the node has mounted, so its size
      // comes from the registry default. Every drag after that uses the real
      // measured size.
      const [width, height] = nodeSize(kind);

      // A rider is the one kind that can be dropped ON something other than the
      // canvas or a group. It takes precedence: if the pointer is over an edge,
      // that is what the drop meant.
      const hit =
        kind === TUBE_TYPE
          ? nearestEdge(graphRef.current.edges, exact, SNAP_DIST)
          : null;

      setNodes((nds) => {
        const id = mintId("n", idsOf(nds, graphRef.current.edges));

        if (hit) {
          return sortParentsFirst(
            nds.concat(
              makeNode(kind, {
                id,
                // centred on the path: a rider straddles its edge rather than
                // hanging off it by its top-left corner
                position: { x: hit.x - width / 2, y: hit.y - height / 2 },
                data: {
                  attach: { edgeId: hit.edgeId, t: hit.t, angle: hit.angle },
                },
              }),
            ),
          );
        }

        const parent = isUnparented({ type: kind })
          ? null
          : groupAt({ ...position, width, height }, nds);
        const origin = parent ? absRect(parent.id) : null;

        return sortParentsFirst(
          nds.concat(
            makeNode(kind, {
              id,
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

  const trackPointer = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      pointerRef.current = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
    },
    [screenToFlowPosition],
  );

  const forgetPointer = useCallback(() => {
    pointerRef.current = null;
  }, []);

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
        selectedNodeCount={nodes.reduce((n, x) => n + (x.selected ? 1 : 0), 0)}
        onImport={() => setImportOpen(true)}
        onImportYaml={() => setYamlImportOpen(true)}
        onViewYaml={() => setYamlViewOpen(true)}
        importYamlRef={importYamlRef}
        viewYamlRef={viewYamlRef}
        scheme={scheme}
        onToggleScheme={onToggleScheme}
      />

      <OrdoImportDialog
        open={yamlImportOpen}
        onClose={closeYamlImport}
        canvasEmpty={nodes.length === 0 && edges.length === 0}
        onImport={onOrdoImport}
      />

      <ViewYamlDialog
        open={yamlViewOpen}
        onClose={closeYamlView}
        session={session}
        onExported={onOrdoExported}
      />

      <ImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImport={onMermaidText}
        describe={describeMermaid}
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
          onPointerMove={trackPointer}
          onPointerLeave={forgetPointer}
        >
          {/* marker <defs> mounted once; edges reference them by url(#id) */}
          <EdgeMarkers />

          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChangeAligned}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeDrag={onNodeDrag}
            onNodeDragStop={onNodeDragStop}
            connectionMode={ConnectionMode.Loose}
            // A sequence diagram is tall out of all proportion to a flowchart.
            // React Flow's default floor of 0.5 stops fitView ever fitting one,
            // so the canvas would open on a corner of it.
            minZoom={0.1}
            snapToGrid
            snapGrid={[GRID, GRID]}
            deleteKeyCode={["Backspace", "Delete"]}
            // Shift-drag rubber-bands; Cmd/Ctrl-click adds to the selection.
            // "partial" means grazing a node selects it, which is what people
            // expect from a lasso and stops big groups being unselectable.
            selectionKeyCode="Shift"
            multiSelectionKeyCode={["Meta", "Control"]}
            selectionMode={SelectionMode.Partial}
            // React Flow's own chrome: controls, minimap, handles, the lasso.
            colorMode={scheme}
          >
            {/* keeps every rider on the edge it was dropped on */}
            <TubeFollower />
            <AlignmentGuides guides={guides} />

            <Background
              variant={BackgroundVariant.Lines}
              gap={GRID}
              size={1}
              color={theme["canvas.grid"]}
              bgColor={theme["canvas.bg"]}
            />
            <MiniMap />
            <Controls />
          </ReactFlow>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [scheme, toggleScheme] = useColorScheme();
  return (
    <ThemeContext.Provider value={THEMES[scheme]}>
      <ReactFlowProvider>
        <Flow scheme={scheme} onToggleScheme={toggleScheme} />
        {/* One container for every toast in the app. Above the import dialog's
            backdrop (z 2000) on its own z-index, and top-centre so that a
            warning about the dialog lands in the column it occupies. The close
            button is pinned in the corner over the toast's padding, so a long
            first line needs room kept clear for it on the right. */}
        <ToastContainer
          position="top-center"
          theme={scheme}
          toastStyle={{
            fontFamily: "system-ui, sans-serif",
            fontSize: 13.5,
            paddingRight: 30,
          }}
        />
      </ReactFlowProvider>
    </ThemeContext.Provider>
  );
}
