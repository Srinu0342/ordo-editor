// Selection algebra: the pure part of multi-select, drag and clipboard.
//
// Nothing here touches React Flow, the store or the DOM. It takes node/edge
// arrays plus an `absRect(id)` lookup and gives arrays back, which is what lets
// the same rules be reused by the drag commit, by copy/paste, and by anything
// that later wants to act on "the selection" (align, group, export a slice).

// --- rectangles -------------------------------------------------------------

export const unionRect = (rects) => {
  if (!rects.length) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.height);
  }

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
};

// --- containment tree -------------------------------------------------------

// `ids` plus everything nested under them. Copying a group has to copy what is
// inside it — a container pasted empty is not the thing that was selected.
export const withDescendants = (nodes, ids) => {
  const childrenOf = new Map();
  for (const n of nodes) {
    if (!n.parentId) continue;
    const siblings = childrenOf.get(n.parentId) ?? [];
    siblings.push(n.id);
    childrenOf.set(n.parentId, siblings);
  }

  const out = new Set();
  const visit = (id) => {
    if (out.has(id)) return; // also the cycle guard
    out.add(id);
    (childrenOf.get(id) ?? []).forEach(visit);
  };
  ids.forEach(visit);
  return out;
};

export const selectedIds = (nodes) =>
  new Set(nodes.filter((n) => n.selected).map((n) => n.id));

// React Flow requires a parent to appear BEFORE its children in the array.
export const sortParentsFirst = (nodes) => {
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

// --- clipboard --------------------------------------------------------------

// State React Flow owns and recomputes. Carrying any of it into a paste gives
// you a node that believes it is mid-drag, or one sized from a stale measure.
const TRANSIENT_NODE_KEYS = [
  "selected",
  "dragging",
  "measured",
  "positionAbsolute",
  "internals",
  "resizing",
];

const clean = (node) => {
  const copy = structuredClone(node);
  for (const key of TRANSIENT_NODE_KEYS) delete copy[key];
  if (copy.data) delete copy.data.isDropTarget; // drop highlight, never content
  return copy;
};

const cleanEdge = (edge) => {
  const copy = structuredClone(edge);
  delete copy.selected;
  return copy;
};

/**
 * Snapshot the current node selection into a clipboard payload.
 *
 * Roots — nodes whose parent is NOT part of the copy — are rewritten into
 * ABSOLUTE coordinates and lose their parentId, because the frame they were
 * relative to may not exist, or may not be under the cursor, at paste time.
 * Nodes copied together with their parent keep their parent-relative position,
 * so the internal shape of a group survives the round trip untouched.
 *
 * Only edges with BOTH ends in the copy come along: a dangling edge is not a
 * smaller version of the selection, it is a broken one.
 */
export function copySelection({ nodes, edges, absRect }) {
  const ids = withDescendants(nodes, selectedIds(nodes));
  if (!ids.size) return null;

  const rootRects = [];

  const copied = nodes
    .filter((n) => ids.has(n.id))
    .map((n) => {
      if (n.parentId && ids.has(n.parentId)) return clean(n);

      const rect = absRect(n.id);
      if (rect) rootRects.push(rect);

      const { parentId: _released, ...rest } = n;
      return clean({
        ...rest,
        position: rect ? { x: rect.x, y: rect.y } : n.position,
      });
    });

  return {
    nodes: copied,
    edges: edges
      .filter((e) => ids.has(e.source) && ids.has(e.target))
      .map(cleanEdge),
    // union of the ROOT rects, which is the visual extent: children live inside
    // the parents that were measured for it.
    bounds: unionRect(rootRects) ?? { x: 0, y: 0, width: 0, height: 0 },
  };
}

/**
 * Re-id a clipboard payload so it can coexist with the original.
 *
 * Internal references are remapped, never reused: parentId points at the copy
 * of the parent, and an edge reconnects the copies of its endpoints. Roots move
 * by (dx, dy); children keep their offset inside their parent, which moves for
 * them. Everything comes back `selected`, so a paste leaves you holding what
 * you just pasted.
 */
export function cloneGraph(clip, { newNodeId, newEdgeId, dx = 0, dy = 0 }) {
  const idMap = new Map(clip.nodes.map((n) => [n.id, newNodeId()]));

  const nodes = clip.nodes.map((n) => {
    const copy = clean(n);
    const parentId = n.parentId ? idMap.get(n.parentId) : undefined;

    return {
      ...copy,
      id: idMap.get(n.id),
      ...(parentId ? { parentId } : {}),
      position: parentId
        ? copy.position
        : { x: copy.position.x + dx, y: copy.position.y + dy },
      selected: true,
    };
  });

  const edges = clip.edges.map((e) => {
    const source = idMap.get(e.source);
    const target = idMap.get(e.target);
    return {
      ...cleanEdge(e),
      id: newEdgeId(source, target),
      source,
      target,
      selected: true,
    };
  });

  return { nodes, edges };
}
