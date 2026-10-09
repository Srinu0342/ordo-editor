// Text style: a node's or line's own size and weight over its kind's font, a
// default never stored, and what a mixed selection shows.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  clampTextSize,
  fontOf,
  summarizeText,
  weightName,
  withTextStyle,
} from "../textStyle.ts";
import type { TextStyle } from "../textStyle.ts";
import { baseFont, makeNode, TEXT_FONT } from "../nodes/defaults.ts";
import { LABEL_FONT } from "../ops.ts";
import { NOTE_FONT } from "../shapes/registry.ts";

const BOX = { size: 16, weight: 600 };

test("own size and weight win over the kind's font, and only where given", () => {
  assert.deepEqual(fontOf(BOX), BOX);
  assert.deepEqual(fontOf(BOX, { textSize: 22 }), { size: 22, weight: 600 });
  assert.deepEqual(fontOf(BOX, { textWeight: "regular" }), { size: 16, weight: 400 });
});

test("a value equal to the kind's own is dropped, not stored", () => {
  type Data = TextStyle & { label: string };
  const data: Data = { label: "API", textSize: 22, textWeight: "bold" };
  const plain: Data = { label: "API" };
  assert.deepEqual(withTextStyle(data, { textSize: 16, textWeight: "semibold" }, BOX), { label: "API" });
  assert.deepEqual(withTextStyle(data, {}, BOX), { label: "API" });
  assert.deepEqual(withTextStyle(plain, { textSize: 18, textWeight: "semibold" }, BOX), {
    label: "API",
    textSize: 18,
  });
});

test("a mixed selection shows no shared value, and knows when there is something to reset", () => {
  const same = summarizeText([{ base: BOX }, { base: BOX, own: {} }]);
  assert.deepEqual(same, { count: 2, size: 16, weight: "semibold", restyled: false });
  const mixed = summarizeText([{ base: BOX }, { base: TEXT_FONT, own: { textSize: 20 } }]);
  assert.deepEqual(mixed, { count: 2, size: null, weight: null, restyled: true });
  assert.deepEqual(summarizeText([]), { count: 0, size: null, weight: null, restyled: false });
});

test("sizes stay in range; weights name the heaviest step they reach", () => {
  assert.equal(clampTextSize(3), 8);
  assert.equal(clampTextSize(400), 72);
  assert.equal(clampTextSize(15.6), 16);
  assert.equal(weightName(400), "regular");
  assert.equal(weightName(650), "semibold");
  assert.equal(weightName(800), "bold");
});

test("each kind's text starts from the font it draws in; one with no text has none", () => {
  const at = { x: 0, y: 0 };
  assert.deepEqual(baseFont(makeNode("rect", { id: "a", position: at })), LABEL_FONT);
  assert.deepEqual(baseFont(makeNode("note", { id: "b", position: at })), NOTE_FONT);
  assert.deepEqual(baseFont(makeNode("label", { id: "c", position: at })), TEXT_FONT);
  assert.equal(baseFont(makeNode("f-circ", { id: "d", position: at })), null); // a junction has no slot
  assert.equal(baseFont(makeNode("tube", { id: "e", position: at })), null);
});
