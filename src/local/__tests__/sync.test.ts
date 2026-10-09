// Sync's decision table (OrdoInteraction.md, section 6), every row of it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { canvasState, decideSync } from "../sync.ts";
import type { CanvasState, FileState, SyncAction } from "../sync.ts";

const TABLE: [CanvasState, FileState, SyncAction][] = [
  ["unchanged", "same", "nothing"],
  ["changed", "same", "write"],
  ["unchanged", "changed", "load"],
  ["changed", "changed", "conflict"],
  ["unchanged", "changed-invalid", "show-invalid"],
  ["changed", "changed-invalid", "conflict-invalid"],
  ["unchanged", "deleted", "close"],
  ["changed", "deleted", "deleted"],
  ["unexportable", "same", "blocked"],
  ["unexportable", "changed", "blocked-take"],
  ["unexportable", "changed-invalid", "blocked"],
  ["unexportable", "deleted", "blocked"],
];

test("all twelve combinations decide as the table says", () => {
  assert.equal(TABLE.length, 12);
  for (const [canvas, file, action] of TABLE) assert.equal(decideSync(canvas, file), action, `${canvas} × ${file}`);
});

test("no path writes over a file that changed", () => {
  for (const [canvas, file] of TABLE)
    if (file !== "same") assert.notEqual(decideSync(canvas, file), "write", `${canvas} × ${file}`);
});

test("the canvas is compared with its own export, not the file", () => {
  assert.equal(canvasState(null, "a"), "unexportable");
  assert.equal(canvasState("a", "a"), "unchanged");
  assert.equal(canvasState("a\n", "a"), "changed");
});
