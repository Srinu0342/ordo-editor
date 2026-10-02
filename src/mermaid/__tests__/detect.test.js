// The type decides the pipeline, so the type has to be read right — through
// whatever comes before the keyword — and anything without an importer has to
// be refused by name.
import { test } from "node:test";
import assert from "node:assert/strict";

import { detectDiagram, importMermaid } from "../index.js";
import { LOUNGE } from "./fixtures.js";

const family = (text) => detectDiagram(text).family;

test("sequence diagrams are recognised however they open", () => {
  assert.equal(family("sequenceDiagram\n  A->>B: hi"), "sequence");
  assert.equal(family("\n\n   sequenceDiagram\n  A->>B: hi"), "sequence");
  assert.equal(family("%% a comment\nsequenceDiagram\n  A->>B: hi"), "sequence");
  assert.equal(family('%%{init: {"theme": "dark"}}%%\nsequenceDiagram\n  A->>B: hi'), "sequence");
  assert.equal(family("---\ntitle: Hello\n---\nsequenceDiagram\n  A->>B: hi"), "sequence");
});

test("flowcharts are recognised in every spelling", () => {
  assert.equal(family("flowchart TD\n  A-->B"), "flowchart");
  assert.equal(family("graph LR\n  A-->B"), "flowchart");
  assert.equal(family("flowchart-elk TD\n  A-->B"), "flowchart");
});

test("a Markdown file is read for its first mermaid fence", () => {
  const md = [
    "# Notes",
    "",
    "```mermaid",
    "sequenceDiagram",
    "  A->>B: hi",
    "```",
    "",
    "~~~mermaid",
    "flowchart TD",
    "  A-->B",
    "~~~",
  ].join("\n");
  const found = detectDiagram(md);
  assert.equal(found.family, "sequence");
  assert.equal(found.blocks, 2);
  assert.equal(found.source.trim(), "sequenceDiagram\n  A->>B: hi");
});

test("other Mermaid types are named, with no importer", () => {
  const found = detectDiagram("classDiagram\n  A <|-- B");
  assert.equal(found.family, null);
  assert.equal(found.type, "classDiagram");
  assert.equal(found.label, "Class diagram — no importer yet");
  assert.equal(detectDiagram("stateDiagram-v2\n  [*] --> A").label, "State diagram — no importer yet");
});

test("text that is not Mermaid at all is said to be so", () => {
  assert.deepEqual(
    [detectDiagram("hello world").type, detectDiagram("hello world").label],
    [null, "Not a Mermaid diagram"],
  );
  assert.equal(detectDiagram("   ").label, "Nothing to import");
});

test("the router refuses what it has no importer for, by name", async () => {
  await assert.rejects(importMermaid("classDiagram\n  A <|-- B"), /Class diagram.*flowcharts and sequence diagrams/);
  await assert.rejects(importMermaid("hello world"), /Not a Mermaid diagram/);
});

test("the router sends a sequence diagram down the parse-only path", async () => {
  const result = await importMermaid(LOUNGE);
  assert.equal(result.family, "sequence");
  assert.ok(result.nodes.some((n) => n.type === "tube"));
  assert.ok(result.edges.some((e) => e.id.startsWith("seq:life:")));
});
