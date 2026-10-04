// TEST ORACLE. Mermaid's own renderer, run under jsdom, as a check on the
// importer's TOPOLOGY — column order, message order, how many activations each
// participant has and how deep, which frames sit inside which. Never on pixel
// values: those are Mermaid's, and Ordo's are deliberately its own.
//
// It touches internals no production code may: `renderer.bounds` and its
// `endActivation`. Breakage here blocks CI, never an import.
import { dom, shimTextGeometry } from "./dom.ts";

import { test } from "node:test";
import assert from "node:assert/strict";

import { ENROLMENT, LOUNGE } from "./fixtures.ts";
import type { Fragment } from "../sequence.ts";

shimTextGeometry();

// The sequence renderer's layout state, as far as the oracle reads it. Mermaid
// does not type it: it is internals, and only this file may touch them.
type Loop = { title?: string; starty: number; stopy: number };
type Bounds = {
  endActivation: (msg: unknown) => { actor: string; startx: number };
  models: {
    actors: { name: string; x: number; width: number }[];
    messages: { from: string; to: string }[];
    loops: Loop[];
  };
};

// A frame and the frames inside it, by guard title.
type Tree = { title: string; children: Tree[] };

const { default: mermaid } = await import("../mermaid.ts");
const { readSequence } = await import("../sequence.ts");

async function oracle(src: string) {
  const diagram = await mermaid.mermaidAPI.getDiagramFromText(src);
  const ours = readSequence(diagram);

  // Activations are spliced out of `bounds` as they close, so they are
  // captured on the way out. `bounds` is one module-level object shared by
  // every render, so the hook comes off again afterwards.
  const { bounds } = diagram.renderer as typeof diagram.renderer & {
    bounds: Bounds;
  };
  const captured: { actor: string; startx: number }[] = [];
  const endActivation = bounds.endActivation;
  bounds.endActivation = function (this: Bounds, msg: unknown) {
    const r = endActivation.call(this, msg);
    captured.push({ actor: r.actor, startx: r.startx });
    return r;
  };

  // The diagram's own render, not mermaid.render(): that builds a separate
  // diagram instance, and this one's `bounds` would stay empty.
  dom.window.document.body.innerHTML = '<svg id="oracle"></svg>';
  try {
    await diagram.render("oracle", "12.0.0");
  } finally {
    bounds.endActivation = endActivation;
  }

  // Copied out now: the next render clears the shared models.
  const { actors, messages, loops } = bounds.models;
  return {
    ours,
    theirs: { actors: [...actors], messages: [...messages], loops: [...loops] },
    captured,
    // the sequence diagram's own config, which is where activationWidth lives
    conf: diagram.db.getConfig!() as { activationWidth?: number },
  };
}

// Frames as a nesting of guard titles, from Mermaid's loop boxes by interval
// containment, and from the importer's tree directly.
const norm = (t: unknown) => String(t ?? "").replace(/^\[|\]$/g, "").replace(/\s+/g, " ").trim();

function theirNesting(loops: Loop[]) {
  const sorted = [...loops].sort((p, q) => p.starty - q.starty || q.stopy - p.stopy);
  const roots: Tree[] = [];
  const stack: { loop: Loop; node: Tree }[] = [];
  for (const loop of sorted) {
    const node = { title: norm(loop.title), children: [] };
    while (stack.length && stack[stack.length - 1].loop.stopy < loop.stopy) stack.pop();
    (stack.length ? stack[stack.length - 1].node.children : roots).push(node);
    stack.push({ loop, node });
  }
  return roots;
}

const ourNesting = (frames: Fragment[]): Tree[] =>
  frames.map((f) => ({ title: norm(f.guards[0]), children: ourNesting(f.children) }));

const sortTree = (nodes: Tree[]): Tree[] =>
  nodes
    .map((n) => ({ ...n, children: sortTree(n.children) }))
    .sort((p, q) => p.title.localeCompare(q.title));

for (const [name, src] of [
  ["enrolment", ENROLMENT],
  ["notes", LOUNGE],
]) {
  const { ours, theirs, captured, conf } = await oracle(src);

  test(`${name}: column order matches Mermaid's`, () => {
    const order = [...theirs.actors]
      .filter((a, i, all) => all.findIndex((b) => b.name === a.name) === i)
      .sort((p, q) => p.x - q.x)
      .map((a) => a.name);
    assert.deepEqual(order, ours.actors.map((a) => a.id));
  });

  test(`${name}: message order matches Mermaid's`, () => {
    assert.deepEqual(
      theirs.messages.map((m) => `${m.from}→${m.to}`),
      ours.entries.filter((e) => e.kind === "message").map((e) => `${e.from}→${e.to}`),
    );
  });

  test(`${name}: activations per participant, and their depths, match Mermaid's`, () => {
    // Mermaid offsets a nested bar by half its width per level; undo that.
    const half = (conf.activationWidth ?? 10) / 2;
    const centre = new Map(theirs.actors.map((a) => [a.name, a.x + a.width / 2]));
    const depths = (list: { actor: string; depth: number }[]) =>
      Object.fromEntries(
        [...new Set(list.map((s) => s.actor))]
          .sort()
          .map((actor) => [
            actor,
            list.filter((s) => s.actor === actor).map((s) => s.depth).sort(),
          ]),
      );
    const theirsByActor = depths(
      captured.map((c) => ({
        actor: c.actor,
        depth: Math.round((c.startx - centre.get(c.actor)!) / half) + 2,
      })),
    );
    assert.deepEqual(depths(ours.spans), theirsByActor);
  });

  test(`${name}: frames nest as Mermaid's do`, () => {
    assert.deepEqual(sortTree(ourNesting(ours.fragments)), sortTree(theirNesting(theirs.loops)));
  });
}
