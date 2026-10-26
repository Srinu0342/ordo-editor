// The agent guide in docs/agents/: every page fills its lists from the code,
// and every YAML example in it reads clean, so the guide never teaches a file
// the editor would refuse.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

import { GUIDE_PAGES, fill, guidePage } from "../guide.ts";
import { readDiagram } from "../../src/ordo/index.ts";
import { SHAPE_GROUPS } from "../../src/shapes/registry.ts";

const examples = (text: string) => [...text.matchAll(/```yaml\n([\s\S]*?)```/g)].map((m) => m[1]);

test("every page fills its lists, and every YAML example in it is a valid diagram", async () => {
  for (const page of GUIDE_PAGES) {
    const text = await guidePage(page);
    assert.doesNotMatch(text, /\{\{list:/, page);
    for (const [i, yaml] of examples(text).entries()) {
      const read = readDiagram(yaml);
      assert.deepEqual(
        read.diagnostics.map((d) => `${d.line}:${d.col} ${d.message}`),
        [],
        `${page}, example ${i + 1}`,
      );
      assert.equal(read.ok, true, `${page}, example ${i + 1}`);
    }
  }
});

test("docs/agents holds the pages the guide serves, and no others", async () => {
  const files = (await fs.readdir(new URL("../../docs/agents/", import.meta.url))).filter((f) => f.endsWith(".md"));
  assert.deepEqual(files.sort(), GUIDE_PAGES.map((p) => `${p}.md`).sort());
});

test("the shape list has a line per palette group, with every key in it", () => {
  const lines = fill("{{list:shapes}}").split("\n");
  assert.equal(lines.length, SHAPE_GROUPS.length);
  SHAPE_GROUPS.forEach(([, title, set], i) => {
    assert.ok(lines[i].startsWith(`- ${title}: `), lines[i]);
    for (const key of Object.keys(set)) assert.ok(lines[i].includes(`\`${key}\``), key);
  });
  assert.match(fill("{{list:shapes}}"), /`brace-r` \(comment, right, \d+ × \d+\)/);
});

test("each shape says how much label it holds, or that it shows none", () => {
  const shapes = fill("{{list:shapes}}");
  for (const key of ["sm-circ", "fr-circ", "fork"]) assert.match(shapes, new RegExp(`\`${key}\` \\([^)]*no label\\)`), key);
  // what the canvas showed: "Payment service" fits a rect's line, "accepted?" does not fit a diamond's
  assert.match(shapes, /`rect` \(process, 15 × 2\)/);
  assert.match(shapes, /`diam` \(decision, 8 × 2\)/);
  assert.match(shapes, /`circle` \(\d+ × \d+\)/); // no name in brackets where the key says it
});

test("the size lists: every shape as it is dropped, and the other kinds in numbers from the code", () => {
  const sizes = fill("{{list:sizes}}").split("\n");
  assert.equal(sizes.length, SHAPE_GROUPS.length);
  SHAPE_GROUPS.forEach(([, title, set], i) => {
    assert.ok(sizes[i].startsWith(`- ${title}: `), sizes[i]);
    for (const [key, s] of Object.entries(set)) assert.ok(sizes[i].includes(`\`${key}\` ${s.size[0]} × ${s.size[1]}`), key);
  });
  const kinds = fill("{{list:kindSizes}}");
  assert.match(kinds, /^- group: .*24 px past the rightmost/m);
  assert.match(kinds, /^- class: 190 px wide.*1 \+ 1 rows \d+, /m);
  assert.match(kinds, /^- text: as big as its words/m);
  assert.match(kinds, /^- an edge's label: a pill/m);
  assert.equal(fill("{{list:groupPad}} {{list:groupTop}}"), "24 56");
});

test("fill: a list Ordo doesn't have is a mistake in the page; other braces are content", () => {
  assert.throws(() => fill("{{list:colours}}"), /not a list Ordo has/);
  assert.equal(fill("A{{text}} is a hexagon"), "A{{text}} is a hexagon");
  assert.equal(fill("lines: {{list:lines}}"), "lines: `solid`, `dotted`, `dashed`, `thick`");
});
