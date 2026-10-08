// Which face an edge without a pinned handle uses, and where on that face it
// lands: the rule the Mermaid importer and OrdoEdge share (edges/faces.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Position } from "@xyflow/react";

import {
  anchorPoint,
  defaultEnds,
  handlesFor,
  nodeBox,
} from "../faces.ts";
import type { HandleBox, MeasuredNode, NodeBox } from "../faces.ts";
import { toOrdo } from "../../mermaid/toOrdo.ts";
import { importOrdo } from "../../ordo/index.ts";
import type { OrdoNode, XY } from "../../types.ts";

const fixture = (name: string) =>
  readFileSync(
    new URL(`../../ordo/__tests__/fixtures/${name}`, import.meta.url),
    "utf8",
  );

// The rule exactly as mermaid/toOrdo.ts had it before it moved, kept here as
// the oracle that the move changed nothing the importer can see.
const LEGACY_BY_DIRECTION: Record<string, [source: string, target: string]> = {
  TB: ["s", "n"],
  TD: ["s", "n"],
  BT: ["n", "s"],
  LR: ["e", "w"],
  RL: ["w", "e"],
};
function legacyHandlesFor(
  from: XY | undefined,
  to: XY | undefined,
  direction: string | undefined,
): [source: string, target: string] {
  const fallback = LEGACY_BY_DIRECTION[direction ?? ""] ?? LEGACY_BY_DIRECTION.TB;
  if (!from || !to) return fallback;

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === 0) return fallback;

  if (Math.abs(dy) >= Math.abs(dx)) return dy >= 0 ? ["s", "n"] : ["n", "s"];
  return dx >= 0 ? ["e", "w"] : ["w", "e"];
}

const O = { x: 100, y: 100 };
const off = (dx: number, dy: number) => ({ x: O.x + dx, y: O.y + dy });

// ---------------------------------------------------------------------------
// handlesFor
// ---------------------------------------------------------------------------

test("the dominant axis between the centres picks the faces", () => {
  assert.deepEqual(handlesFor(O, off(0, 80)), ["s", "n"], "straight below");
  assert.deepEqual(handlesFor(O, off(0, -80)), ["n", "s"], "straight above");
  assert.deepEqual(handlesFor(O, off(80, 0)), ["e", "w"], "straight right");
  assert.deepEqual(handlesFor(O, off(-80, 0)), ["w", "e"], "straight left");
  assert.deepEqual(handlesFor(O, off(30, 80)), ["s", "n"], "mostly below");
  assert.deepEqual(handlesFor(O, off(-30, -80)), ["n", "s"], "mostly above");
  assert.deepEqual(handlesFor(O, off(80, 79)), ["e", "w"], "mostly right");
  assert.deepEqual(handlesFor(O, off(-80, -79)), ["w", "e"], "mostly left");
});

test("a diagonal tie goes to the vertical", () => {
  assert.deepEqual(handlesFor(O, off(50, 50)), ["s", "n"]);
  assert.deepEqual(handlesFor(O, off(-50, 50)), ["s", "n"]);
  assert.deepEqual(handlesFor(O, off(50, -50)), ["n", "s"]);
  assert.deepEqual(handlesFor(O, off(-50, -50)), ["n", "s"]);
});

test("the direction only breaks a coincidence, and is top-down by default", () => {
  assert.deepEqual(handlesFor(O, O), ["s", "n"]);
  assert.deepEqual(handlesFor(O, O, "TB"), ["s", "n"]);
  assert.deepEqual(handlesFor(O, O, "TD"), ["s", "n"]);
  assert.deepEqual(handlesFor(O, O, "BT"), ["n", "s"]);
  assert.deepEqual(handlesFor(O, O, "LR"), ["e", "w"]);
  assert.deepEqual(handlesFor(O, O, "RL"), ["w", "e"]);
  assert.deepEqual(handlesFor(O, O, "sideways"), ["s", "n"], "unknown direction");
  assert.deepEqual(handlesFor(undefined, O, "LR"), ["e", "w"], "no source centre");
  assert.deepEqual(handlesFor(O, undefined, "BT"), ["n", "s"], "no target centre");

  // Geometry wins whenever there is any.
  assert.deepEqual(handlesFor(O, off(0, 10), "LR"), ["s", "n"]);
  assert.deepEqual(handlesFor(O, off(10, 0), "TB"), ["e", "w"]);
});

test("a direction named after an Object.prototype member is just unknown", () => {
  for (const name of ["constructor", "toString", "__proto__", "hasOwnProperty"])
    assert.deepEqual(handlesFor(O, O, name), ["s", "n"], name);
});

test("moving the rule out of the Mermaid importer changed none of its answers", () => {
  const directions = [undefined, "TB", "TD", "BT", "LR", "RL", "XX"];
  const steps = [-3, -2, -1, -0.5, 0, 0.5, 1, 2, 3];
  let compared = 0;
  for (const direction of directions) {
    for (const dx of steps)
      for (const dy of steps) {
        const to = off(dx * 40, dy * 40);
        assert.deepEqual(
          handlesFor(O, to, direction),
          legacyHandlesFor(O, to, direction),
          `${direction} ${dx},${dy}`,
        );
        compared++;
      }
    assert.deepEqual(handlesFor(undefined, O, direction), legacyHandlesFor(undefined, O, direction));
    assert.deepEqual(handlesFor(O, undefined, direction), legacyHandlesFor(O, undefined, direction));
  }
  assert.equal(compared, directions.length * steps.length * steps.length);
});

test("the Mermaid importer still pins each flowchart edge by the shared rule", () => {
  // Mermaid hands over centres in one flat space; d sits on a's centre.
  const node = (id: string, x: number, y: number) => ({ id, x, y, width: 80, height: 40, shape: "rect" });
  const edge = (id: string, start: string, end: string) => ({ id, start, end, arrowTypeEnd: "arrow_point" });
  const layout = {
    direction: "LR",
    nodes: [node("a", 0, 0), node("b", 300, 20), node("c", 10, 200), node("d", 0, 0)],
    edges: [edge("ab", "a", "b"), edge("ba", "b", "a"), edge("ac", "a", "c"), edge("ca", "c", "a"), edge("ad", "a", "d")],
  };
  const { edges } = toOrdo(layout as unknown as Parameters<typeof toOrdo>[0]);
  assert.deepEqual(
    edges.map((e) => [e.id, e.sourceHandle, e.targetHandle]),
    [
      ["ab", "e", "w"],
      ["ba", "w", "e"],
      ["ac", "s", "n"],
      ["ca", "n", "s"],
      ["ad", "e", "w"], // coincident: the diagram's direction decides
    ],
  );
});

// ---------------------------------------------------------------------------
// Where an end lands
// ---------------------------------------------------------------------------

// The four compass anchors as React Flow measures them: an 8px box (a 6px
// handle plus its 1px border) centred on each side of a w × h node.
const HANDLE = 8;
const compass = (w: number, h: number): HandleBox[] => [
  { id: "n", x: w / 2 - HANDLE / 2, y: -HANDLE / 2, width: HANDLE, height: HANDLE, position: Position.Top },
  { id: "e", x: w - HANDLE / 2, y: h / 2 - HANDLE / 2, width: HANDLE, height: HANDLE, position: Position.Right },
  { id: "s", x: w / 2 - HANDLE / 2, y: h - HANDLE / 2, width: HANDLE, height: HANDLE, position: Position.Bottom },
  { id: "w", x: -HANDLE / 2, y: h / 2 - HANDLE / 2, width: HANDLE, height: HANDLE, position: Position.Left },
];

const box = (x: number, y: number, w: number, h: number, handles = compass(w, h)): NodeBox => ({
  x,
  y,
  width: w,
  height: h,
  handles,
});

test("an anchor's point is the middle of its handle's outer side, as React Flow places it", () => {
  const node = box(10, 20, 160, 48);
  const [n, e, s, w] = node.handles;
  assert.deepEqual(anchorPoint(node, n), { x: 90, y: 16, position: Position.Top });
  assert.deepEqual(anchorPoint(node, e), { x: 174, y: 44, position: Position.Right });
  assert.deepEqual(anchorPoint(node, s), { x: 90, y: 72, position: Position.Bottom });
  assert.deepEqual(anchorPoint(node, w), { x: 6, y: 44, position: Position.Left });

  // Any handle box, not only a compass anchor: a 6 × 10 tap low on the right.
  const tap: HandleBox = { id: "r2", x: 23, y: 150, width: 6, height: 10, position: Position.Right };
  assert.deepEqual(anchorPoint(box(0, 0, 26, 220, [tap]), tap), { x: 29, y: 155, position: Position.Right });
});

test("a node box is read from React Flow's internal node", () => {
  const handles = compass(160, 48);
  const internal: MeasuredNode = {
    internals: {
      positionAbsolute: { x: 288, y: 208 },
      handleBounds: { source: handles.slice(0, 3), target: handles.slice(3) },
    },
    measured: { width: 160, height: 48 },
    width: 999, // the measured size wins, as it does in React Flow
    height: 999,
  };
  assert.deepEqual(nodeBox(internal), { x: 288, y: 208, width: 160, height: 48, handles });

  assert.deepEqual(
    nodeBox({ internals: { positionAbsolute: { x: 1, y: 2 } }, width: 30, height: 40 }),
    { x: 1, y: 2, width: 30, height: 40, handles: [] },
    "unmeasured, with no handles yet",
  );
  assert.deepEqual(
    nodeBox({ internals: { positionAbsolute: { x: 1, y: 2 }, handleBounds: { source: null, target: null } } }),
    { x: 1, y: 2, width: 0, height: 0, handles: [] },
  );
  assert.equal(nodeBox(undefined), undefined);
});

test("only the ends that name no handle are placed, and only on an anchor that exists", () => {
  const left = box(0, 0, 160, 48);
  const right = box(400, 0, 160, 48);

  assert.deepEqual(defaultEnds(left, right, { source: true, target: true }), {}, "both pinned");
  assert.deepEqual(defaultEnds(undefined, right, { source: false, target: false }), {}, "source unknown");
  assert.deepEqual(defaultEnds(left, undefined, { source: false, target: false }), {}, "target unknown");

  assert.deepEqual(defaultEnds(left, right, { source: false, target: false }), {
    source: { x: 164, y: 24, position: Position.Right },
    target: { x: 396, y: 24, position: Position.Left },
  });
  assert.deepEqual(defaultEnds(left, right, { source: true, target: false }), {
    target: { x: 396, y: 24, position: Position.Left },
  });
  assert.deepEqual(defaultEnds(left, right, { source: false, target: true }), {
    source: { x: 164, y: 24, position: Position.Right },
  });

  // Right to left, and a node with no anchor on the chosen face: that end is
  // left where React Flow puts it.
  const bare = box(0, 0, 160, 48, compass(160, 48).filter((h) => h.id !== "e"));
  assert.deepEqual(defaultEnds(right, left, { source: false, target: false }), {
    source: { x: 396, y: 24, position: Position.Left },
    target: { x: 164, y: 24, position: Position.Right },
  });
  assert.deepEqual(defaultEnds(right, bare, { source: false, target: false }), {
    source: { x: 396, y: 24, position: Position.Left },
  });
  assert.deepEqual(defaultEnds(right, box(0, 0, 26, 220, []), { source: false, target: false }), {
    source: { x: 396, y: 24, position: Position.Left },
  });
});

test("a self-loop on default handles leaves the bottom and comes back in at the top", () => {
  const node = box(0, 0, 160, 48);
  assert.deepEqual(defaultEnds(node, node, { source: false, target: false }), {
    source: { x: 80, y: 52, position: Position.Bottom },
    target: { x: 80, y: -4, position: Position.Top },
  });
});

test("checkout's unpinned edges render face to face; the pinned one is React Flow's", () => {
  const { nodes, edges, diagnostics } = importOrdo(fixture("checkout.ordo"), fixture("checkout.layout.ordo"));
  assert.deepEqual(diagnostics, []);

  // Absolute boxes, the way React Flow derives them: positions are relative to
  // the parent, and a box has no intrinsic size, so it draws at its style size.
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const absolute = (n: OrdoNode): XY => {
    const p = n.parentId ? absolute(byId.get(n.parentId)!) : { x: 0, y: 0 };
    return { x: p.x + n.position.x, y: p.y + n.position.y };
  };
  const boxOf = (id: string) => {
    const n = byId.get(id)!;
    const at = absolute(n);
    return box(at.x, at.y, n.style!.width!, n.style!.height!);
  };
  assert.deepEqual(
    ["client", "gateway", "api", "db"].map((id) => {
      const b = boxOf(id);
      return [id, b.x, b.y, b.width, b.height];
    }),
    [
      ["client", 0, 160, 160, 48],
      ["gateway", 264, 56, 160, 48],
      ["api", 288, 208, 160, 48],
      ["db", 288, 304, 140, 88],
    ],
  );

  const ends = Object.fromEntries(
    edges.map((e) => [
      e.id,
      defaultEnds(boxOf(e.source), boxOf(e.target), {
        source: e.sourceHandle != null,
        target: e.targetHandle != null,
      }),
    ]),
  );
  assert.deepEqual(ends, {
    // client sits left of the gateway: right face to left face, not top to top
    e1: {
      source: { x: 164, y: 184, position: Position.Right },
      target: { x: 260, y: 80, position: Position.Left },
    },
    // gateway above api, api above db: bottom face to top face
    e2: {
      source: { x: 344, y: 108, position: Position.Bottom },
      target: { x: 368, y: 204, position: Position.Top },
    },
    e3: {
      source: { x: 368, y: 260, position: Position.Bottom },
      target: { x: 358, y: 300, position: Position.Top },
    },
    // e4 names both of its handles in the layout file
    e4: {},
  });
  assert.deepEqual(
    edges.filter((e) => e.id === "e4").map((e) => [e.sourceHandle, e.targetHandle]),
    [["e", "w"]],
  );
});
