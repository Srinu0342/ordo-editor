// Undo history: the pure part.
//
// A step is a DIFF between two moments of the graph, not a copy of either. For
// each node and edge that changed it holds the path inside it that changed and
// the value on both sides; an item that came or went is held whole; and when
// the id order moved, the stretch of it that did. Undo writes a step's `before`
// side back over the live graph and redo its `after` side. Anything a step does
// not mention is left exactly as it is live — which is what lets an undo land
// without trampling the selection, measured sizes, or anything else the canvas
// owns.
//
// Nothing here touches React, React Flow or the DOM. Where a step begins and
// ends is useHistory's call; this file only knows what one is.

import {
  TRANSIENT_NODE_KEYS,
  cleanEdge,
  cleanNode,
  sortParentsFirst,
} from "./selection.ts";
import { TUBE_TYPE } from "./nodes/tube.ts";
import type { Graph, OrdoEdge, OrdoNode } from "./types.ts";

// What history diffs: a node or an edge, read as a plain record.
type Item = { id: string } & Record<string, unknown>;

// A key path into an item, outermost first: ["data", "attach", "t"].
type Path = string[];

// [id, path, before, after]. An empty path is the whole item, undefined on
// the side where it does not exist.
type Change = [id: string, path: Path, before: unknown, after: unknown];

// The stretch of the id order that moved; see diffOrder.
type Order = { at: number; before: string[]; after: string[] };

type ListStep = { changes: Change[]; order: Order | null };

/** One undo step: what changed in each list, or null where nothing did. */
export type Step = { nodes: ListStep | null; edges: ListStep | null };

export type Direction = "undo" | "redo";

type Rules<T> = {
  skip: (prev: T, next: T) => Set<string>;
  clean: (item: T) => T;
};

// How far back undo reaches. Past this the oldest step falls off.
export const HISTORY_LIMIT = 30;

// --- what a step records ----------------------------------------------------

// Never part of a step: interaction state React Flow recomputes, and the drop
// highlight a drag paints on a group. Undoing a selection would be undoing a
// click.
const SKIP_NODE = new Set([...TRANSIENT_NODE_KEYS, "data.isDropTarget"]);
const SKIP_EDGE = new Set(["selected"]);

// A rider attached before AND after a step has its position, and its edge's
// tangent, re-derived from `attach` by TubeFollower. The step keeps the
// attachment and leaves those two to the follower: recorded, the follower's own
// corrections would read as edits. A rider that attaches or lets go during the
// step keeps its position — that is where it was dropped.
const SKIP_RIDER = new Set([...SKIP_NODE, "position", "data.attach.angle"]);

const isRiding = (node: OrdoNode) =>
  node.type === TUBE_TYPE && Boolean(node.data?.attach);

const NODES: Rules<OrdoNode> = {
  skip: (prev, next) =>
    isRiding(prev) && isRiding(next) ? SKIP_RIDER : SKIP_NODE,
  clean: cleanNode,
};
const EDGES: Rules<OrdoEdge> = { skip: () => SKIP_EDGE, clean: cleanEdge };

// --- diff -------------------------------------------------------------------

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

const idOf = (item: Item) => item.id;

// Structural equality for what a node holds: records, arrays, plain values. A
// key holding undefined and a missing key are the same thing.
function isEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((v, i) => isEqual(v, b[i]))
    );
  }
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  for (const key of new Set([...Object.keys(x), ...Object.keys(y)])) {
    if (!isEqual(x[key], y[key])) return false;
  }
  return true;
}

// Every leaf that differs between `a` and `b`, as [path, before, after].
// Records are walked key by key; anything else — an array, a plain value — is
// one leaf, so a tube's `taps` change as a list rather than tap by tap.
function diffValue(
  a: unknown,
  b: unknown,
  path: Path,
  skip: Set<string>,
  out: [Path, unknown, unknown][],
) {
  if (Object.is(a, b)) return;
  if (isRecord(a) && isRecord(b)) {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const at = [...path, key];
      if (!skip.has(at.join("."))) diffValue(a[key], b[key], at, skip, out);
    }
    return;
  }
  if (!isEqual(a, b)) out.push([path, a, b]);
}

// The id order as a splice: the stretch between the longest common head and
// tail, as it read on either side. An add, a delete, and the reshuffle
// sortParentsFirst does after a re-parent each come out as one short stretch.
function diffOrder(prev: string[], next: string[]): Order | null {
  let head = 0;
  while (head < prev.length && head < next.length && prev[head] === next[head])
    head += 1;
  if (head === prev.length && head === next.length) return null;

  let tail = 0;
  while (
    tail < prev.length - head &&
    tail < next.length - head &&
    prev[prev.length - 1 - tail] === next[next.length - 1 - tail]
  )
    tail += 1;

  return {
    at: head,
    before: prev.slice(head, prev.length - tail),
    after: next.slice(head, next.length - tail),
  };
}

// One list, nodes or edges. Each change is [id, path, before, after]; an empty
// path is the whole item, undefined on the side where it does not exist.
function diffList<T extends Item>(
  prev: T[],
  next: T[],
  rules: Rules<T>,
): ListStep | null {
  if (prev === next) return null;

  const was = new Map(prev.map((item) => [item.id, item]));
  const is = new Map(next.map((item) => [item.id, item]));
  const changes: Change[] = [];

  for (const [id, a] of was) {
    const b = is.get(id);
    if (!b) {
      changes.push([id, [], rules.clean(a), undefined]);
    } else if (a !== b) {
      const leaves: [Path, unknown, unknown][] = [];
      diffValue(a, b, [], rules.skip(a, b), leaves);
      for (const [path, before, after] of leaves)
        changes.push([id, path, before, after]);
    }
  }
  for (const [id, b] of is) {
    if (!was.has(id)) changes.push([id, [], undefined, rules.clean(b)]);
  }

  const order = diffOrder(prev.map(idOf), next.map(idOf));
  return changes.length || order ? { changes, order } : null;
}

/**
 * The step that takes graph `before` to graph `after`, or null when nothing the
 * user made is different. A new selection, a re-measure, a drop highlight and a
 * rider re-seated on its edge all come out null.
 */
export function diffGraph(before: Graph, after: Graph): Step | null {
  const nodes = diffList(before.nodes, after.nodes, NODES);
  const edges = diffList(before.edges, after.edges, EDGES);
  return nodes || edges ? { nodes, edges } : null;
}

// --- apply ------------------------------------------------------------------

// `record` with `value` written at `path`, each record on the way down copied
// so nothing shared with another state is touched. undefined deletes the key.
function setIn<R extends Record<string, unknown>>(
  record: R,
  [key, ...rest]: Path,
  value: unknown,
): R {
  const copy: Record<string, unknown> = { ...record };
  if (rest.length) {
    const inner = record?.[key];
    copy[key] = setIn(isRecord(inner) ? inner : {}, rest, value);
  } else if (value === undefined) {
    delete copy[key];
  } else {
    copy[key] = value;
  }
  // The same record with one path rewritten, which is what a step recorded.
  return copy as R;
}

// The live order with the step's stretch swapped for the other side's. If the
// live order does not hold that stretch where the step expects it — something
// moved that the step does not know about — the live order stands.
function spliceOrder(
  ids: string[],
  { at, before, after }: Order,
  direction: Direction,
) {
  const [from, to] = direction === "undo" ? [after, before] : [before, after];
  const holds =
    at + from.length <= ids.length && from.every((id, i) => ids[at + i] === id);
  return holds
    ? [...ids.slice(0, at), ...to, ...ids.slice(at + from.length)]
    : ids;
}

function applyList<T extends Item>(
  items: T[],
  { changes, order }: ListStep,
  direction: Direction,
): T[] {
  const byId = new Map(items.map((item) => [item.id, item]));

  for (const [id, path, before, after] of changes) {
    const value = direction === "undo" ? before : after;
    const item = byId.get(id);
    if (!path.length) {
      // a whole item, as the step recorded it
      if (value === undefined) byId.delete(id);
      else byId.set(id, value as T);
    } else if (item) {
      byId.set(id, setIn(item, path, value));
    }
  }

  const ids = items.map(idOf);
  const out: T[] = [];
  for (const id of order ? spliceOrder(ids, order, direction) : ids) {
    const item = byId.get(id);
    if (!item) continue;
    out.push(item);
    byId.delete(id);
  }
  // Whatever the order did not place. Only reachable when the live list
  // drifted from the step, and better on the end than gone.
  return out.concat([...byId.values()]);
}

/**
 * `nodes` with `step` undone (its before side written back) or redone. Every
 * order a step restores already has parents first, so sortParentsFirst leaves
 * it alone; it only steps in if the live list had drifted.
 */
export const applyNodes = (
  nodes: OrdoNode[],
  step: Step,
  direction: Direction,
) =>
  step.nodes
    ? sortParentsFirst(applyList(nodes, step.nodes, direction))
    : nodes;

export const applyEdges = (
  edges: OrdoEdge[],
  step: Step,
  direction: Direction,
) =>
  step.edges ? applyList(edges, step.edges, direction) : edges;

export const applyStep = (
  graph: Graph,
  step: Step,
  direction: Direction,
): Graph => ({
  nodes: applyNodes(graph.nodes, step, direction),
  edges: applyEdges(graph.edges, step, direction),
});

// --- the stack --------------------------------------------------------------

/**
 * Undo and redo stacks. `push` lays a new step on top, dropping the oldest past
 * `limit`, and discards everything undone: a change made after an undo
 * overrides the steps it undid. `undo` and `redo` move one step across and hand
 * it back to be applied, or null when there is nothing on that side.
 */
export function createUndoStack<S = Step>(limit = HISTORY_LIMIT) {
  const done: S[] = [];
  const undone: S[] = [];

  return {
    push(step: S) {
      done.push(step);
      if (done.length > limit) done.shift();
      undone.length = 0;
    },
    undo() {
      const step = done.pop() ?? null;
      if (step) undone.push(step);
      return step;
    },
    redo() {
      const step = undone.pop() ?? null;
      if (step) done.push(step);
      return step;
    },
  };
}
