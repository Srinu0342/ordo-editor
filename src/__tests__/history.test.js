// The undo history's pure half: what a step records, that both directions land
// exactly, and how the stack treats a limit and an override.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  HISTORY_LIMIT,
  applyStep,
  createUndoStack,
  diffGraph,
} from "../history.js";

const box = (id, extra = {}) => ({
  id,
  type: "box",
  position: { x: 0, y: 0 },
  style: { width: 120, height: 60 },
  data: { shape: "rect", label: "" },
  ...extra,
});

const wire = (id, source, target, extra = {}) => ({
  id,
  source,
  target,
  type: "step",
  style: { stroke: "#0f172a", strokeWidth: 1.5 },
  data: { label: "", markerStart: "none", markerEnd: "arrow-filled" },
  ...extra,
});

const rider = (id, attach, extra = {}) => ({
  id,
  type: "tube",
  position: { x: 40, y: 80 },
  style: { width: 26, height: 220 },
  data: { slots: 3, ...(attach && { attach }) },
  ...extra,
});

const graph = (nodes, edges = []) => ({ nodes, edges });

const patch = (item, fields) => ({ ...item, ...fields });
const relabel = (item, label) => ({ ...item, data: { ...item.data, label } });

// Undo from `b` lands on `a`, redo from `a` lands on `b`.
function roundTrip(a, b) {
  const step = diffGraph(a, b);
  assert.ok(step, "a real change makes a step");
  assert.deepEqual(applyStep(b, step, "undo"), a);
  assert.deepEqual(applyStep(a, step, "redo"), b);
  return step;
}

test("nothing changed, or only what the canvas owns, is no step", () => {
  const a = box("a");
  const e = wire("e", "a", "b");
  const g = graph([a, box("b")], [e]);

  assert.equal(diffGraph(g, g), null);
  // equal values in new objects are not a change
  assert.equal(diffGraph(g, structuredClone(g)), null);

  const touched = graph(
    [
      {
        ...a,
        selected: true,
        dragging: false,
        resizing: false,
        measured: { width: 120, height: 60 },
        data: { ...a.data, isDropTarget: true },
      },
      box("b"),
    ],
    [{ ...e, selected: true }],
  );
  assert.equal(diffGraph(g, touched), null);
});

test("a step holds only the paths that changed", () => {
  const a = box("a");
  const step = diffGraph(graph([a, box("b")]), graph([relabel(a, "Hi"), box("b")]));

  assert.deepEqual(step, {
    nodes: { changes: [["a", ["data", "label"], "", "Hi"]], order: null },
    edges: null,
  });
});

test("undo and redo land exactly on either side of a change", () => {
  const a = box("a");
  const e = wire("e", "a", "b");
  const before = graph([a, box("b")], [e]);
  const after = graph(
    [
      relabel(patch(a, { position: { x: 120, y: 40 }, width: 200 }), "moved"),
      box("b"),
    ],
    [
      {
        ...e,
        type: "curved",
        style: { stroke: "#dc2626", strokeWidth: 3, strokeDasharray: "8 4" },
      },
    ],
  );
  roundTrip(before, after);
});

test("a key that comes or goes is restored, not left as undefined", () => {
  const plain = box("a");
  const nested = box("a", { parentId: "g", zIndex: 1 });
  const g = box("g", { type: "container" });
  const step = roundTrip(graph([g, plain]), graph([g, nested]));

  const undone = applyStep(graph([g, nested]), step, "undo").nodes[1];
  assert.ok(!("parentId" in undone) && !("zIndex" in undone));
});

test("a deleted item comes back where it was, and its edges with it", () => {
  const [a, b, c] = ["a", "b", "c"].map((id) => box(id));
  const ab = wire("ab", "a", "b");
  const bc = wire("bc", "b", "c");
  const ac = wire("ac", "a", "c");

  roundTrip(graph([a, b, c], [ab, ac, bc]), graph([a, c], [ac]));
});

test("pasted or imported items leave on undo and return on redo", () => {
  const a = box("a");
  const before = graph([a]);
  const after = graph(
    [a, box("g", { type: "container" }), box("x", { parentId: "g" })],
    [wire("gx", "g", "x")],
  );
  roundTrip(before, after);
});

test("re-parenting is undone along with the reshuffle that put the parent first", () => {
  const child = box("c", { position: { x: 300, y: 300 } });
  const group = box("g", { type: "container" });
  const before = graph([box("a"), child, group, box("z")]);
  // what onNodeDragStop does: adopt, re-express the position, parents first
  const after = graph([
    box("a"),
    group,
    { ...child, parentId: "g", position: { x: 20, y: 30 } },
    box("z"),
  ]);
  const step = roundTrip(before, after);
  assert.deepEqual(step.nodes.order, { at: 1, before: ["c", "g"], after: ["g", "c"] });
});

test("an undo leaves the selection and measured sizes as they are live", () => {
  const a = box("a");
  const step = diffGraph(graph([a, box("b")]), graph([relabel(a, "Hi"), box("b")]));

  const live = graph([
    { ...relabel(a, "Hi"), selected: true, measured: { width: 120, height: 60 } },
    { ...box("b"), selected: true },
  ]);
  const [undoneA, untouchedB] = applyStep(live, step, "undo").nodes;
  assert.equal(undoneA.data.label, "");
  assert.equal(undoneA.selected, true);
  assert.deepEqual(undoneA.measured, { width: 120, height: 60 });
  assert.equal(untouchedB, live.nodes[1], "an item the step never named is the same object");
});

test("an item a step brings back carries none of the canvas's state", () => {
  const a = box("a");
  const live = { ...a, selected: true, measured: { width: 1, height: 1 } };
  const step = diffGraph(graph([live]), graph([]));

  const [back] = applyStep(graph([]), step, "undo").nodes;
  assert.deepEqual(back, a);
});

test("a rider's position and tangent belong to the follower, not to a step", () => {
  const on = { edgeId: "life", t: 0.25, angle: 90 };
  const riding = rider("r", on);

  // the follower re-seating it: no step
  const reseated = rider("r", { ...on, angle: 89.5 }, { position: { x: 41, y: 96 } });
  assert.equal(diffGraph(graph([riding]), graph([reseated])), null);

  // slid along its edge: the step keeps `t`, and leaves where it sits to the follower
  const slid = rider("r", { ...on, t: 0.6, angle: 91 }, { position: { x: 44, y: 150 } });
  assert.deepEqual(diffGraph(graph([riding]), graph([slid])).nodes.changes, [
    ["r", ["data", "attach", "t"], 0.25, 0.6],
  ]);
});

test("a rider that lets go of its edge goes back on it, and lands where it was dropped again", () => {
  const riding = rider("r", { edgeId: "life", t: 0.25, angle: 90 });
  const free = rider("r", null, { position: { x: 400, y: 20 } });
  roundTrip(graph([riding]), graph([free]));
  roundTrip(graph([free]), graph([riding]));
});

test(`the stack reaches back ${HISTORY_LIMIT} steps and no further`, () => {
  const stack = createUndoStack();
  const steps = Array.from({ length: HISTORY_LIMIT + 5 }, (_, i) => ({ i }));
  steps.forEach((s) => stack.push(s));

  const undone = [];
  for (let s = stack.undo(); s; s = stack.undo()) undone.push(s.i);
  assert.equal(undone.length, HISTORY_LIMIT);
  assert.deepEqual(undone, steps.slice(5).map((s) => s.i).reverse());
});

test("redo walks forward again until a new change overrides it", () => {
  const stack = createUndoStack();
  const [one, two, three] = [{ n: 1 }, { n: 2 }, { n: 3 }];
  stack.push(one);
  stack.push(two);

  assert.equal(stack.undo(), two);
  assert.equal(stack.undo(), one);
  assert.equal(stack.undo(), null);
  assert.equal(stack.redo(), one);
  assert.equal(stack.redo(), two);
  assert.equal(stack.redo(), null);

  assert.equal(stack.undo(), two);
  stack.push(three); // the override: `two` can no longer be redone
  assert.equal(stack.redo(), null);
  assert.equal(stack.undo(), three);
  assert.equal(stack.undo(), one);
});

// Random edits, recorded as steps and then walked all the way back and all the
// way forward again: every intermediate graph has to come back exactly. Seeded,
// so a failure reproduces.
test("any run of edits undoes and redoes through every state it passed", () => {
  let seed = 7;
  const rand = (n) => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed % n;
  };
  let minted = 0;

  const edit = ({ nodes, edges }) => {
    const pick = (list) => list[rand(list.length)];
    switch (rand(6)) {
      case 0: // add, somewhere in the middle
      {
        const at = rand(nodes.length + 1);
        const fresh = box(`n${minted++}`, { position: { x: rand(500), y: rand(500) } });
        return { nodes: [...nodes.slice(0, at), fresh, ...nodes.slice(at)], edges };
      }
      case 1: // delete, with the edges that touched it
      {
        if (!nodes.length) return { nodes, edges };
        const gone = pick(nodes).id;
        return {
          nodes: nodes.filter((n) => n.id !== gone),
          edges: edges.filter((e) => e.source !== gone && e.target !== gone),
        };
      }
      case 2: // move
      {
        if (!nodes.length) return { nodes, edges };
        const id = pick(nodes).id;
        return {
          nodes: nodes.map((n) =>
            n.id === id ? { ...n, position: { x: rand(500), y: n.position.y } } : n,
          ),
          edges,
        };
      }
      case 3: // relabel
      {
        if (!nodes.length) return { nodes, edges };
        const id = pick(nodes).id;
        return {
          nodes: nodes.map((n) => (n.id === id ? relabel(n, `l${rand(9)}`) : n)),
          edges,
        };
      }
      case 4: // connect
      {
        if (nodes.length < 2) return { nodes, edges };
        const [s, t] = [pick(nodes).id, pick(nodes).id];
        return { nodes, edges: [...edges, wire(`e${minted++}`, s, t)] };
      }
      default: // reorder: one node jumps somewhere else in the list
      {
        if (nodes.length < 2) return { nodes, edges };
        const from = rand(nodes.length);
        const rest = nodes.filter((_, i) => i !== from);
        const to = rand(rest.length + 1);
        return {
          nodes: [...rest.slice(0, to), nodes[from], ...rest.slice(to)],
          edges,
        };
      }
    }
  };

  const states = [graph([box("a"), box("b"), box("c")])];
  const steps = [];
  for (let i = 0; i < 400; i++) {
    const next = edit(states.at(-1));
    const step = diffGraph(states.at(-1), next);
    if (!step) continue;
    steps.push(step);
    states.push(next);
  }
  assert.ok(steps.length > 300);

  let g = states.at(-1);
  for (let i = steps.length - 1; i >= 0; i--) {
    g = applyStep(g, steps[i], "undo");
    assert.deepEqual(g, states[i], `undo of step ${i}`);
  }
  for (let i = 0; i < steps.length; i++) {
    g = applyStep(g, steps[i], "redo");
    assert.deepEqual(g, states[i + 1], `redo of step ${i}`);
  }
});
