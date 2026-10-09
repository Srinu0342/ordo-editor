// The undo history's React half, driven the way the canvas drives it: writes
// to the node list, and pointer and key events on the window between them.
import { test } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import type { Dispatch, SetStateAction } from "react";
import type { OrdoEdge, OrdoNode } from "../types.ts";

// React DOM looks for a DOM when it loads, so the window goes up first.
const { window } = new JSDOM("<!doctype html><html><body></body></html>");
Object.assign(globalThis, {
  window,
  document: window.document,
  HTMLElement: window.HTMLElement,
  IS_REACT_ACT_ENVIRONMENT: true,
});

const { act, createElement, useState } = await import("react");
const { createRoot } = await import("react-dom/client");
const { HISTORY_LIMIT } = await import("../history.ts");
const { useHistory, isTyping } = await import("../useHistory.ts");

const box = (id: string, label = ""): OrdoNode => ({
  id,
  type: "box",
  position: { x: 0, y: 0 },
  data: { shape: "rect", label },
});

// A canvas with nothing on it but the two lists and the history. `view` always
// holds the latest render; unmounting takes the window listeners down with it.
type View = {
  nodes: OrdoNode[];
  setNodes: Dispatch<SetStateAction<OrdoNode[]>>;
  setEpoch: Dispatch<SetStateAction<number>>;
  undo: () => void;
  redo: () => void;
};

function mount(t: TestContext, nodes: OrdoNode[]) {
  const view = {} as View;
  function Canvas() {
    const [ns, setNodes] = useState(nodes);
    const [es, setEdges] = useState<OrdoEdge[]>([]);
    const [epoch, setEpoch] = useState(0);
    const history = useHistory({ nodes: ns, edges: es, setNodes, setEdges, epoch });
    Object.assign(view, { nodes: ns, setNodes, setEpoch }, history);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  act(() => root.render(createElement(Canvas)));
  t.after(() => act(() => root.unmount()));
  return view;
}

const fire = (target: EventTarget, type: string, init: object) =>
  target.dispatchEvent(new window[type.startsWith("key") ? "KeyboardEvent" : "MouseEvent"](type, { bubbles: true, ...init }));
const press = (target: EventTarget = document.body) => fire(target, "pointerdown", { button: 0 });
const lift = (target: EventTarget = document.body) => fire(target, "pointerup", { button: 0 });
const click = (target?: EventTarget) => (press(target), lift(target));
const key = (target: EventTarget, k?: string) => fire(target, "keydown", { key: k });

const write = (view: View, fn: (nodes: OrdoNode[]) => OrdoNode[]) => act(() => view.setNodes(fn));
const label = (view: View, id: string, text: string) =>
  write(view, (nds) =>
    nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, label: text } } : n)),
  );
const moveTo = (view: View, id: string, x: number) =>
  write(view, (nds) =>
    nds.map((n) => (n.id === id ? { ...n, position: { x, y: 0 } } : n)),
  );
const undo = (view: View) => act(() => view.undo());
const redo = (view: View) => act(() => view.redo());
const labelOf = (view: View, id: string) =>
  view.nodes.find((n) => n.id === id)!.data.label;
const xOf = (view: View, id: string) =>
  view.nodes.find((n) => n.id === id)!.position.x;

const field = (tag: string, attrs = {}) => {
  const el = Object.assign(document.createElement(tag), attrs);
  document.body.append(el);
  return el;
};

test("everything done between two presses is one step", (t) => {
  const view = mount(t, [box("a")]);

  click();
  write(view, (nds) => [...nds, box("b")]);
  moveTo(view, "b", 50);
  click();

  undo(view);
  assert.deepEqual(view.nodes.map((n) => n.id), ["a"]);
  redo(view);
  assert.deepEqual(view.nodes.map((n) => n.id), ["a", "b"]);
  assert.equal(xOf(view, "b"), 50);
});

test("keys typed into a text field are one edit; keys anywhere else close a step", (t) => {
  const view = mount(t, [box("a")]);
  const input = field("input", { type: "text" });

  click(input);
  for (const text of ["H", "He", "Hey"]) {
    key(input, text.at(-1));
    label(view, "a", text);
  }
  key(document.body, "Escape");
  label(view, "a", "Hey!");

  undo(view);
  assert.equal(labelOf(view, "a"), "Hey");
  undo(view);
  assert.equal(labelOf(view, "a"), "", "the typing came back out as one step");
});

test("a held pointer keeps a gesture whole, and holds undo off until it lets go", (t) => {
  const view = mount(t, [box("a")]);

  press();
  moveTo(view, "a", 10);
  key(document.body, "Shift"); // would close a step, were nothing held
  moveTo(view, "a", 20);

  undo(view);
  assert.equal(xOf(view, "a"), 20, "no undo mid-gesture");

  lift();
  undo(view);
  assert.equal(xOf(view, "a"), 0, "the whole drag goes back at once");
});

test("an edit still open is the first thing undo takes back", (t) => {
  const view = mount(t, [box("a")]);

  click();
  moveTo(view, "a", 10);
  undo(view);
  assert.equal(xOf(view, "a"), 0);
  redo(view);
  assert.equal(xOf(view, "a"), 10);
});

test("a change made after an undo overrides what was undone", (t) => {
  const view = mount(t, [box("a")]);

  click();
  label(view, "a", "one");
  click();
  label(view, "a", "two");
  click();

  undo(view);
  assert.equal(labelOf(view, "a"), "one");
  label(view, "a", "three");

  redo(view);
  assert.equal(labelOf(view, "a"), "three", "nothing left to redo");
  undo(view);
  assert.equal(labelOf(view, "a"), "one");
  undo(view);
  assert.equal(labelOf(view, "a"), "");
});

test("an undo leaves the selection where it is", (t) => {
  const view = mount(t, [box("a")]);

  click();
  label(view, "a", "x");
  click();
  write(view, (nds) => nds.map((n) => ({ ...n, selected: true })));

  undo(view);
  assert.equal(labelOf(view, "a"), "");
  assert.equal(view.nodes[0].selected, true);
});

test(`only the last ${HISTORY_LIMIT} changes come back`, (t) => {
  const view = mount(t, [box("a")]);
  const extra = 5;

  for (let i = 1; i <= HISTORY_LIMIT + extra; i++) {
    click();
    label(view, "a", `v${i}`);
  }
  for (let i = 0; i < HISTORY_LIMIT + 10; i++) undo(view);
  assert.equal(labelOf(view, "a"), `v${extra}`);
});

test("the follower re-seating a rider after an undo does not cost the redo", (t) => {
  const on = { edgeId: "life", t: 0.2, angle: 90 };
  const view = mount(t, [
    { id: "r", type: "tube", position: { x: 0, y: 40 }, data: { attach: on } },
  ]);
  const slide = (fn: (node: OrdoNode) => OrdoNode) =>
    write(view, (nds) => nds.map((n) => (n.id === "r" ? fn(n) : n)));

  click();
  slide((n) => ({ ...n, data: { attach: { ...on, t: 0.6 } } }));
  click();

  undo(view);
  assert.equal(view.nodes[0].data.attach?.t, 0.2);
  // what TubeFollower writes once the edge is drawn: position and tangent only
  slide((n) => ({
    ...n,
    position: { x: 3, y: 61 },
    data: { attach: { ...n.data.attach!, angle: 90.4 } },
  }));

  redo(view);
  assert.equal(view.nodes[0].data.attach?.t, 0.6);
});

test("a new epoch starts history over from the diagram it brought in", (t) => {
  const view = mount(t, [box("a")]);

  click();
  moveTo(view, "a", 10);
  click();
  label(view, "a", "edited");
  // another tab's diagram replaces the canvas in the same commit as the epoch
  act(() => {
    view.setNodes([box("x"), box("y")]);
    view.setEpoch((e) => e + 1);
  });

  undo(view);
  assert.deepEqual(view.nodes.map((n) => n.id), ["x", "y"], "nothing of the old diagram comes back");
  redo(view);
  assert.deepEqual(view.nodes.map((n) => n.id), ["x", "y"]);

  // and the new diagram's own edits undo as usual
  click();
  moveTo(view, "x", 30);
  undo(view);
  assert.equal(xOf(view, "x"), 0);
});

test("text fields count as typing; selects, colour wells and the canvas do not", () => {
  assert.equal(isTyping(field("input", { type: "text" })), true);
  assert.equal(isTyping(field("input", { type: "search" })), true);
  assert.equal(isTyping(field("textarea")), true);

  assert.equal(isTyping(field("select")), false);
  assert.equal(isTyping(field("input", { type: "color" })), false);
  assert.equal(isTyping(field("button")), false);
  assert.equal(isTyping(document.body), false);
  assert.equal(isTyping(null), false);
});
